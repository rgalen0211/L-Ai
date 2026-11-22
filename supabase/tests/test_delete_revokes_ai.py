"""A paying customer's delete request ends their AI connections (migrations/20261121000550_delete_revokes_ai.sql, NOT APPLIED).
GEO 2026-11-21 (CC1 12:1x). Helpers borrowed from test_connect.py, as test_prepared_data.py does. Run from the repo root with the SQL
venv, TEMP/TMP on D: and RYAGRAM_LAI_REPO set:
    pgvenv/Scripts/python -m unittest supabase/tests/test_delete_revokes_ai.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401


class DeleteRevokesAi(core.Base):
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

    def test_GEO_a_paying_customer_s_delete_request_ends_their_ai_connection_and_only_theirs(self):
        client, a, ref = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        self.runner().one("select connect_list_projects(%s)", h(a))                  # control: Alice's AI works before
        self.db.as_("service").one("select account_request_deletion(%s, %s, 'credit history') is null", ALICE, "alice@x")
        # MUST-FAIL: before 000550 the deleted customer's AI kept acting on the account
        self.runner()                                                                 # fails() runs on the current role: the connector's
        self.fails("select connect_list_projects(%s)", h(a), code="PT401")
        r = self.runner()
        self.assertEqual(r.one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(uuid.uuid4().hex), h(uuid.uuid4().hex)),
                         {"error": "invalid_grant"})                                  # a refresh does not bring it back
        self.assertEqual(self.db.as_(None).one("select count(*) from public.connect_grants where owner_id = %s and revoked_at is null", ALICE), 0)
        self.runner().one("select connect_list_projects(%s)", h(b))                  # Bob's AI still works
        self.db.as_("service").one("select account_request_deletion(%s, %s, 'credit history') is null", ALICE, "alice@x")   # safe twice
        self.assertEqual(self.db.as_(None).one("select count(*) from public.account_deletion_requests where owner_id = %s", ALICE), 1)

    # -- GEO 11-21 (CC1 12:36 G1): the live-steps after-checks and the rollbacks of GEO's migrations
    def g1_check(self, name):
        f = next((core.ROOT / "live-steps").glob("*_" + name + "_after_check.sql"))
        return [bool(r[1]) for r in self.db.as_(None).c.execute(f.read_text(encoding="utf-8")).fetchall()]

    def g1_rollback(self, name):
        f = next((core.ROOT / "rollbacks").glob("*_" + name + "_rollback.sql"))
        self.db.as_(None).c.execute(f.read_text(encoding="utf-8"))

    def test_GEO_g1_after_check_true_then_the_rollback_puts_the_old_body_back(self):
        self.assertEqual(self.g1_check("delete_revokes_ai"), [True] * 3)
        self.g1_rollback("delete_revokes_ai")
        self.assertEqual(self.g1_check("delete_revokes_ai"), [False, True, True])


if __name__ == "__main__":
    unittest.main(verbosity=2)
