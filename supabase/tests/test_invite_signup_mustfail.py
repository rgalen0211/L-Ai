"""CLOUD-SITE 11-02 round 3: must-fail cases for the invite and sign-up flow (migrations/20261003000200_invite_codes.sql and the invite migrations after it), on a local
Postgres, the same setup as test_invites.py. They pin what the SQL ALREADY does; nothing here changes it.

Gaps they close (the existing invite suites cover the rest): a code one second past its expiry; a used-up code after a real sign-up (its use never comes back);
a malformed or listed email never takes a use and never counts as a guess; a code that was SENT to one address and redeemed with another (today: allowed, the code is
the credential; written down for Ryan to decide); and a sweep of EVERY admin_* function in the database as a tester and as a plain account: each must refuse.

Run from the repo root (local throwaway database only):
    pgvenv/Scripts/python -m unittest supabase/tests/test_invite_signup_mustfail.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
TESTER, PLAIN, ADMIN = (str(uuid.UUID(int=i)) for i in (301, 302, 303))
IP = "a" * 64


class InviteSignupMustFail(core.Base):
    def setUp(self):
        super().setUp()
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'tess@x.example'),(%s,'pat@x.example'),(%s,'admin@x.example')", (TESTER, PLAIN, ADMIN))
        d.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        d.execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (TESTER,))

    def owner(self):
        return self.db.as_(None)

    def code(self, uses=1, days=14):
        return self.owner().one("select invite_issue('test', %s, %s)", uses, days)

    def reserve(self, code, email="new@person.example", ip=IP):
        return self.db.as_("service").one("select invite_reserve(%s, %s, %s)", code, email, ip)

    def uses(self, code):
        return self.owner().one("select uses from public.invite_codes where code_hash = ryagram_private.invite_hash(%s)", code)

    def attempts(self):
        return self.owner().one("select count(*) from public.invite_attempts")

    # ------------------------------------------------------------------------------------------------------------ expired
    def test_a_code_one_second_past_its_expiry_is_refused_takes_no_use_and_counts_as_a_guess(self):
        c = self.code(uses=5)
        self.owner().c.execute("update public.invite_codes set expires_at = now() - interval '1 second' where code_hash = ryagram_private.invite_hash(%s)", (c,))
        self.assertEqual(self.reserve(c), {"ok": False, "reason": "invalid"})
        self.assertEqual(self.uses(c), 0)
        self.assertEqual(self.attempts(), 1)
        self.owner().c.execute("update public.invite_codes set expires_at = now() + interval '1 minute' where code_hash = ryagram_private.invite_hash(%s)", (c,))
        self.assertTrue(self.reserve(c)["ok"], "control: the same code a minute before its expiry works")

    def test_an_expired_code_gives_the_same_answer_as_a_made_up_one(self):
        c = self.code()
        self.owner().c.execute("update public.invite_codes set expires_at = now() - interval '1 day' where code_hash = ryagram_private.invite_hash(%s)", (c,))
        self.assertEqual(self.reserve(c), self.reserve("RYA-ZZZZ-ZZZZ"), "no way to tell a real expired code from a guess")

    # ------------------------------------------------------------------------------------------------------------- reused
    def test_a_one_use_code_redeems_once_and_after_a_real_sign_up_its_use_never_comes_back(self):
        c = self.code(uses=1)
        r = self.reserve(c)
        self.assertTrue(r["ok"])
        self.assertEqual(self.reserve(c, "second@person.example"), {"ok": False, "reason": "invalid"})
        self.db.as_("service").one("select invite_sent(%s, %s)", r["redemption"], PLAIN)            # the person signed up
        self.db.as_("service").one("select invite_release(%s)", r["redemption"])                       # a late release changes nothing
        self.assertEqual(self.uses(c), 1)
        self.assertEqual(self.reserve(c, "third@person.example"), {"ok": False, "reason": "invalid"})
        self.assertEqual(self.owner().one("select status from public.invite_redemptions where id = %s", r["redemption"]), "sent")

    def test_a_release_gives_the_use_back_once_however_often_it_is_called(self):
        c = self.code(uses=1)
        r = self.reserve(c)
        for _ in range(3):
            self.db.as_("service").one("select invite_release(%s)", r["redemption"])
        self.assertEqual(self.uses(c), 0)
        self.assertTrue(self.reserve(c, "again@person.example")["ok"])
        self.assertEqual(self.reserve(c, "more@person.example"), {"ok": False, "reason": "invalid"})

    def test_a_disabled_code_is_refused_even_with_uses_left(self):
        c = self.code(uses=10)
        self.assertTrue(self.reserve(c)["ok"])
        self.owner().c.execute("update public.invite_codes set disabled = true where code_hash = ryagram_private.invite_hash(%s)", (c,))
        self.assertEqual(self.reserve(c, "b@person.example"), {"ok": False, "reason": "invalid"})
        self.assertEqual(self.uses(c), 1)

    # -------------------------------------------------------------------------------------------------------- wrong email
    def test_a_malformed_or_listed_email_is_refused_takes_no_use_and_counts_as_no_guess(self):
        c = self.code(uses=1)
        for bad in ("", "   ", "a@b", "no-at-sign.example", "two@@x.example", "sp ace@x.example", "a@x.c", "a@x.example,b@y.example", "a@x.example b@y.example", None):
            self.assertEqual(self.reserve(c, bad), {"ok": False, "reason": "email"}, repr(bad))
        self.assertEqual(self.uses(c), 0)
        self.assertEqual(self.attempts(), 0, "a bad email is not a guess at a code")
        self.assertEqual(self.reserve(c, " real.person@x.example"), {"ok": False, "reason": "email"}, "the SQL alone refuses an untrimmed address (redeem.ts trims and lowers first)")
        self.assertTrue(self.reserve(c, "Real.Person@X.Example")["ok"])
        self.assertEqual(self.owner().one("select email from public.invite_redemptions"), "real.person@x.example", "stored lower case")

    def test_today_a_code_sent_to_one_address_redeems_with_another_decision_for_ryan(self):
        # admin_invite_send_begin binds the address on the first send, so the ADMIN cannot mail the code to anyone else (test_invite_email.py).
        # invite_reserve does not look at that binding: whoever holds the code can sign up with any address. The migration only promises the send binding.
        # This pins TODAY's behaviour so a change is a decision, not an accident (docs/CLOUD-SITE-1102.md, round 3).
        self.owner().c.execute("insert into public.app_admins (user_id) values (%s) on conflict do nothing", (ADMIN,))
        code = self.db.as_(ADMIN).one("select admin_invite_person('Maya Ortiz', 0)")
        self.db.as_(ADMIN).one("select admin_invite_send_begin(%s, 'maya@x.example')", code)
        r = self.reserve(code, "someone.else@y.example")
        self.assertTrue(r["ok"], "today: the code is the credential, not the address")
        self.assertEqual(self.owner().one("select to_addr from public.invite_sends"), "maya@x.example")
        self.assertEqual(self.owner().one("select email from public.invite_redemptions where id = %s", r["redemption"]), "someone.else@y.example")

    # ------------------------------------------------------------------------------------------- admin-only, for testers too
    def admin_functions(self):
        return self.owner().all("""select p.oid::regprocedure::text, p.proname, coalesce(array_to_string(array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t), ','), '')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'admin\\_%%' order by p.proname""")

    def call_as(self, who, name, types):
        args = ", ".join(f"null::{t}" for t in types.split(",") if t)
        try:
            self.db.as_(who).one(f"select public.{name}({args})")
            return "ran"
        except psycopg.Error as e:
            return e.sqlstate

    def test_every_admin_function_refuses_a_tester_and_a_plain_account(self):
        fns = self.admin_functions()
        self.assertGreater(len(fns), 30, "the database has its admin functions")
        open_to = []
        for sig, name, types in fns:
            for who, label in ((TESTER, "tester"), (PLAIN, "plain account")):
                got = self.call_as(who, name, types)
                if got != "42501":
                    open_to.append(f"{sig} as a {label}: {got}")
        self.assertEqual(open_to, [], "every admin_* function must refuse with 42501 before it does anything")

    def test_the_tester_flag_grants_nothing_admin_and_cannot_be_set_by_a_tester(self):
        self.assertFalse(self.db.as_(TESTER).one("select is_app_admin()"))
        for sql in ("select admin_set_local_compute(%s, true, 'because')", "select admin_set_local_compute(%s, false, 'because')"):
            with self.assertRaises(psycopg.Error) as cm:
                self.db.as_(TESTER).one(sql, PLAIN)
            self.assertEqual(cm.exception.sqlstate, "42501")
        self.assertIs(self.owner().one("select local_compute from public.account_settings where owner_id = %s", TESTER), True, "the flag is unchanged")
        for sql in ("select invite_issue('mine', 1000, 365)", "select admin_invite_person('Friend', 1000)"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(TESTER).one(sql)
        self.assertEqual(self.owner().one("select count(*) from public.invite_codes"), 0, "a tester minted no code")

    # Admin functions that do NOT refuse an admin's token carrying a client_id (a token issued to an OAuth client, i.e. an AI acting as the admin). The house rule is
    # ryagram_private.require_app_session ("an admin acts from the app, never through a connected AI"); 18 admin functions keep it, these 22 (older ones) do not.
    # Ryagram's own connector cannot reach any of them (connect_runner may run connect_* only), so this matters only if a Supabase-issued OAuth token for an admin ever
    # exists. Fixing it needs a migration (not allowed in this session): a decision for Ryan (docs/CLOUD-SITE-1102.md, round 3). The list is pinned so it can only SHRINK.
    WITHOUT_APP_SESSION = {
        "admin_ack_stripe", "admin_answer_support", "admin_cost_delete_threshold", "admin_cost_record", "admin_cost_rollup", "admin_cost_set_plan", "admin_cost_set_rate",
        "admin_cost_set_threshold", "admin_creator_beta", "admin_creator_flow_set", "admin_creator_invite", "admin_decide_creator", "admin_department_interest_counts",
        "admin_film_request_set", "admin_film_requests", "admin_funnel", "admin_invite_app_link_make", "admin_invite_person", "admin_invite_send_begin", "admin_invite_send_undo",
        "admin_ops", "admin_review_report"}

    def test_admin_functions_that_let_an_admin_act_through_a_connected_ai_are_exactly_the_known_list(self):
        claims = '{"sub": "%s", "role": "authenticated", "client_id": "some-ai"}' % ADMIN
        lets_ai = set()
        for sig, name, types in self.admin_functions():
            self.db.as_(ADMIN).c.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
            if self.call_as_keeping_claims(name, types) != "42501":
                lets_ai.add(name)
        self.db.c.execute("select set_config('request.jwt.claims', '', false)")
        self.assertEqual(sorted(lets_ai - self.WITHOUT_APP_SESSION), [], "a NEW admin function must refuse a connected AI (call ryagram_private.require_admin)")
        self.assertEqual(sorted(self.WITHOUT_APP_SESSION - lets_ai), [], "one was fixed: take it off WITHOUT_APP_SESSION")

    def call_as_keeping_claims(self, name, types):
        args = ", ".join(f"null::{t}" for t in types.split(",") if t)
        try:
            self.db.one(f"select public.{name}({args})")
            return "ran"
        except psycopg.Error as e:
            return e.sqlstate


if __name__ == "__main__":
    unittest.main()
