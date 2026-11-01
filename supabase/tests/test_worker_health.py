"""Worker health (migrations/20261031000400_admin_worker_health.sql) on a local Postgres (NEXT-WORKER 72).

Built on test_ops_readiness's helpers (the 2A harness: stub, every migration in order). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_worker_health.py -v

  * admin only: a signed-in non-admin, a worker and anon are refused
  * before any ping: every enabled worker 'unknown', no running job, no claim, no commit
  * after a ping: 'ok' with free_gb; four minutes stale: 'delayed'; enabled = false: 'off'
  * a claimed house job shows as running; once it completes with a commit, last_claim_at and last_engine_commit carry it
  * an owner_local (tester) job held by the same worker id is NOT counted (house jobs only)
  * the control row: claims off and disabled job types come through
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_ops_readiness as ops  # noqa: E402

RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2


def setUpModule():
    ops.setUpModule()


class WorkerHealth(core.Base):
    # ops.Ops's helpers only (subclassing Ops would run all of its tests again here)
    project_with_version = core.Core.project_with_version
    claim = core.Core.claim
    admin = ops.Ops.admin
    ping = ops.Ops.ping
    lost_job = ops.Ops.lost_job

    def ryan_admin(self):
        """make_ryan_admin, but safe to call again: the base fixture may already hold Ryan in app_admins (CC1 12:30: UniqueViolation)."""
        c = self.db.as_(None).c
        c.execute("update auth.users set email = 'ryan.galen@uselai.com' where id = %s", (RYAN,))
        c.execute("insert into public.app_admins (user_id, note) select id, 'test' from auth.users where lower(email) = 'ryan.galen@uselai.com' "
                  "on conflict do nothing")

    def health(self):
        self.ryan_admin()
        return self.db.as_(RYAN).one("select admin_worker_health()")

    def worker(self, d, user=WORKER):
        name = self.admin("select name from public.workers where user_id = %s", user)
        return next(w for w in d["workers"] if w["name"] == name)

    def test_admin_only(self):
        self.ryan_admin()
        for who in (OTHER, WORKER, "anon"):
            with self.subTest(who=who):
                self.denied(who, "select admin_worker_health()")

    def test_before_any_ping_every_enabled_worker_is_unknown(self):
        d = self.health()
        self.assertTrue(d["workers"])
        w = self.worker(d)
        self.assertEqual((w["state"], w["running"], w["last_claim_at"], w["last_engine_commit"]), ("unknown", None, None, None))
        self.assertIs(d["claims_enabled"], True)
        self.assertEqual(d["disabled_job_types"], [])

    def test_ok_delayed_and_off(self):
        self.ping()
        w = self.worker(self.health())
        self.assertEqual((w["state"], float(w["free_gb"])), ("ok", 40.0))
        self.ping("4 minutes")
        self.assertEqual(self.worker(self.health())["state"], "delayed")
        self.admin("update public.workers set enabled = false where user_id = %s returning 1", WORKER)
        self.assertEqual(self.worker(self.health())["state"], "off")

    def test_running_then_last_claim_and_commit(self):
        job = self.lost_job(1)                                             # submitted and claimed by WORKER (its lease is then expired; we refresh it)
        self.admin("update public.jobs set lease_expires_at = now() + interval '5 minutes' where id = %s returning 1", job)
        w = self.worker(self.health())
        self.assertEqual((w["running"]["job_type"], w["running"]["state"]), ("preview", "claimed"))
        self.assertIsNotNone(w["last_claim_at"])
        self.admin("update public.jobs set state = 'complete', engine_commit = 'abcdef1234567', ended_at = now() where id = %s returning 1", job)
        w = self.worker(self.health())
        self.assertIsNone(w["running"])
        self.assertEqual(w["last_engine_commit"]["commit"], "abcdef1234567")
        self.assertIsNotNone(w["last_engine_commit"]["ended_at"])

    def test_tester_jobs_are_not_counted(self):
        # A tester's job is ORDERED owner_local (jobs_place() at insert, from account_settings.local_compute; the place is fixed after,
        # jobs_place_fixed(), as test_r9_node proves). Even with the worker's id on it, the house worker's view does not count it.
        self.admin("insert into public.account_settings (owner_id, local_compute) values (%s, true) "
                   "on conflict (owner_id) do update set local_compute = true returning 1", RYAN)
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid)
        self.assertEqual(self.admin("select run_on::text from public.jobs where id = %s", job), "owner_local")
        self.admin("update public.jobs set state = 'claimed', claimed_at = now(), worker_user_id = %s, "
                   "lease_expires_at = now() + interval '5 minutes' where id = %s returning 1", WORKER, job)
        w = self.worker(self.health())
        self.assertEqual((w["running"], w["last_claim_at"]), (None, None))

    def test_control_row_comes_through(self):
        self.admin("update public.control set claims_enabled = false, disabled_job_types = '{final_render}' returning 1")
        d = self.health()
        self.assertEqual((d["claims_enabled"], d["disabled_job_types"]), (False, ["final_render"]))


if __name__ == "__main__":
    unittest.main()
