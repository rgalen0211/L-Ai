"""CLOUD-SITE 11-02 round 3 (task 4): the connector's limits under real concurrency, on a local Postgres (the same setup as test_connect.py, whose helpers this borrows).
Calls that arrive at the SAME instant on separate database connections: the per-minute counter counts every one exactly once; two accounts bursting together each get their
own allowance; and two identical contact sheets started at once queue ONE job (submit_job locks the version row first). Pins what the SQL already does; nothing is changed.

Run from the repo root (local throwaway database only):
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_abuse.py -v
"""
import sys
import threading
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB, ADMIN, NOBODY = tc.ALICE, tc.BOB, tc.ADMIN, tc.NOBODY
URI, h = tc.URI, tc.h


class ConnectAbuse(core.Base):
    def setUp(self):
        core.Base.setUp(self)
        self.dbname = f"t{core._count}"
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'nobody@x')", (ALICE, BOB, ADMIN, NOBODY))
        d.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude'), ('loopback', 'loopback', 'loopback')", (URI,))
        self.counter = 0

    runner = tc.Connect.runner
    app = tc.Connect.app
    register = tc.Connect.register
    connect = tc.Connect.connect

    def runners(self, n):
        """n more database connections to this test's database, each as connect_runner (the role the connect function uses)."""
        out = []
        for _ in range(n):
            c = psycopg.connect(core._server.get_uri(database=self.dbname), autocommit=True)
            c.execute("set role connect_runner")
            out.append(c)
        return out

    def burst(self, conns, sql, args_for, per_conn):
        """Every connection runs `per_conn` calls, all threads released at the same instant. Returns the answers (or the SQLSTATE of a refusal)."""
        gate, out, lock = threading.Barrier(len(conns)), [], threading.Lock()

        def work(i, c):
            gate.wait()
            for k in range(per_conn):
                try:
                    v = c.execute(sql, args_for(i, k)).fetchone()[0]
                except psycopg.Error as e:
                    v = ("refused", e.sqlstate, str(e).split("\n")[0])
                with lock:
                    out.append((i, v))
        ts = [threading.Thread(target=work, args=(i, c)) for i, c in enumerate(conns)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        for c in conns:
            c.close()
        return out

    def test_a_burst_on_six_connections_at_once_is_counted_exactly_once_per_call(self):
        _, a, _ = self.connect(ALICE)
        out = self.burst(self.runners(6), "select connect_hit(%s, 'calls', 60, 60)", lambda i, k: (h(a),), 15)          # 90 calls, limit 60
        self.assertEqual(len(out), 90)
        self.assertEqual(sum(1 for _, v in out if v is True), 60, "exactly the limit, never more under concurrency")
        self.assertEqual(self.db.as_(None).one("select sum(n) from public.connect_buckets where bucket like 'calls:%%'"), 90)

    def test_two_accounts_bursting_together_each_get_their_own_allowance(self):
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        out = self.burst(self.runners(4), "select connect_hit(%s, 'calls_acct', 120, 60)", lambda i, k: (h(a) if i % 2 == 0 else h(b),), 80)   # 160 each, limit 120
        for who in (0, 1):
            ok = sum(1 for i, v in out if i % 2 == who and v is True)
            self.assertEqual(ok, 120, f"account {who}")

    def test_two_identical_contact_sheets_started_at_the_same_instant_queue_one_job(self):
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        p = r.one("select connect_create_project(%s, 'Race')", h(a))["id"]
        v = r.one("select connect_current_version(%s, %s)", h(a), p)
        r.one("select connect_save_story(%s, %s, %s::jsonb)", h(a), v, tc.STORY)
        out = self.burst(self.runners(5), "select connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", lambda i, k: (h(a), v), 1)
        started = [x for _, x in out if not (isinstance(x, tuple) and x[0] == "refused")]
        refused = [x for _, x in out if isinstance(x, tuple) and x[0] == "refused"]
        self.assertEqual(len(started), 1, out)
        self.assertEqual(len(refused), 4)
        for _, state, words in refused:
            self.assertEqual(state, "42501")
            self.assertIn("already in progress", words, "the refusal is a plain sentence")
        self.assertEqual(self.db.as_(None).one("select count(*) from public.jobs where version_id = %s and job_type = 'contact_sheet'", v), 1)

    def test_a_burst_from_a_revoked_token_is_refused_every_time_and_counts_nothing(self):
        client, a, _ = self.connect(ALICE)
        self.runner().one("select connect_revoke(%s)", h(a))
        out = self.burst(self.runners(3), "select connect_hit(%s, 'calls', 60, 60)", lambda i, k: (h(a),), 10)
        self.assertTrue(all(isinstance(v, tuple) and v[1] == "PT401" for _, v in out), out[:3])
        self.assertEqual(self.db.as_(None).all("select who, bucket, n from public.connect_buckets where bucket like 'calls%%'"), [], 'nothing counted for a dead token (the sign-in left only its own register count)')


if __name__ == "__main__":
    unittest.main()
