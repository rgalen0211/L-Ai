"""The Wednesday live step GEO owns (LAUNCH-LIVE-STEPS section 00, step 3a), on a local Postgres with every migration. GEO 2026-11-23.

  * live-steps/52_join_daily_max_set.sql, run part by part as Ryan will: part 1 shows 200 and the flag; part 2 with Ryan's number
    sets it and join_reserve then answers 'full' past that number (and not before; a repeat of the same address takes no second place); part 3 shows the number; part 2 unchanged
    (the undo) puts 200 back and the next stranger is let in again. The file's part 2 as shipped changes nothing.
  * live-steps/58_wednesday_watch.sql (CC1 10:05): read-only; on a quiet database every row reads calm (0 waiting, none failed,
    each scheduled job's last run); then each row moves on its own planted case: 2 queued (the oldest 45 min), 3 sign-ups in the
    last hour of which 2 made 30 min ago and 1 of those not opened, a failed crash twice + an older failure outside the hour,
    2 different addresses (one of them twice) against a size of 10, a job that never ran and one inactive. It changes nothing.
Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_wed_live_steps.py -v
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
STEP52 = core.ROOT / "live-steps" / "52_join_daily_max_set.sql"
STEP58 = core.ROOT / "live-steps" / "58_wednesday_watch.sql"
CRON_STANDIN = """
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
create table if not exists cron.job_run_details (jobid int, status text, start_time timestamptz not null default now());
"""


def parts():
    """the three statements, split on the file's own '-- PART n' headers, exactly as Ryan pastes them"""
    text = STEP52.read_text(encoding="utf-8")
    chunks = re.split(r"^-- PART \d.*$", text, flags=re.M)[1:]
    assert len(chunks) == 3, len(chunks)
    return [c.strip() for c in chunks]


class WedLiveSteps(core.Base):
    def d(self):
        return self.db.as_(None).c

    def join(self, mail, ip):
        return self.db.as_("service").one("select public.join_reserve(%s, %s)", mail, ip)

    def test_GEO_52_sets_the_size_and_the_undo_puts_200_back(self):
        p1, p2, p3 = parts()
        self.assertIn("= 200;", p2, "the shipped part 2 is the undo: it sets the default")
        self.assertTrue(p1.lstrip().lower().startswith("select") and p3.lstrip().lower().startswith("select"), "parts 1 and 3 are read-only")
        self.assertEqual(self.d().execute(p1).fetchall(), [(200, False)], "BEFORE: the default, sign-up still closed")
        self.d().execute(p2)                                                     # unchanged = no change
        self.assertEqual(self.d().execute(p3).fetchall(), [(200,)])
        self.assertEqual(self.d().execute("select join_open, waiting_accounts from public.ops_settings").fetchall(), [(False, False)], "part 2 touches nothing but the size: it never opens sign-up or moves the waiting switch")
        self.d().execute("update public.ops_settings set join_open = true")     # live step 47
        self.d().execute(p2.replace("= 200;", "= 2;"))                          # Ryan types his number
        self.assertEqual(self.d().execute(p3).fetchall(), [(2,)], "AFTER shows his number")
        self.assertEqual(self.join("a@example.com", "ipA"), {"ok": True})
        self.assertEqual(self.join("a@example.com", "ipA2"), {"ok": True}, "the same person pressing Send again takes no second place (people, not tries)")
        self.assertEqual(self.join("b@example.com", "ipB"), {"ok": True})
        self.assertEqual(self.join("c@example.com", "ipC"), {"ok": False, "reason": "full"}, "the 3rd try with a size of 2")
        self.d().execute(p2)                                                     # the undo
        self.assertEqual(self.d().execute(p3).fetchall(), [(200,)])
        self.assertEqual(self.join("c@example.com", "ipC"), {"ok": True}, "after the undo the next stranger is let in")


    def watch(self):
        return {r[0]: (r[1], r[2]) for r in self.d().execute(STEP58.read_text(encoding="utf-8")).fetchall()}

    def job(self, pid, vid, state, minutes_ago, code=None):
        return self.d().execute(
            "insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256, state, created_at, queued_at, ended_at, error_code)"
            " values (%s, %s, %s, 'contact_sheet', '{}'::jsonb, repeat('a', 64), %s, now() - make_interval(mins => %s), now() - make_interval(mins => %s),"
            " case when %s in ('failed', 'editorial_action_required', 'complete') then now() - make_interval(mins => %s) end, %s) returning id",
            (core.RYAN, pid, vid, state, minutes_ago, minutes_ago, state, minutes_ago, code)).fetchone()[0]

    def test_GEO_58_the_wednesday_watch_reads_each_signal_and_changes_nothing(self):
        self.d().execute(CRON_STANDIN)
        self.d().execute("update auth.users set created_at = now() - interval '2 days'")   # the template's four test users are not new sign-ups
        self.d().execute("insert into cron.job (jobname, schedule, command) values ('ops-tick', '* * * * *', 'x'), ('purge-partial-uploads', '30 * * * *', 'x')")
        self.d().execute("insert into cron.job (jobname, schedule, command, active) values ('cost-sync', '0 * * * *', 'x', false)")
        tick = self.d().execute("select jobid from cron.job where jobname = 'ops-tick'").fetchone()[0]
        self.d().execute("insert into cron.job_run_details (jobid, status, start_time) values (%s, 'failed', now() - interval '5 minutes'), (%s, 'succeeded', now() - interval '1 minute')", (tick, tick))
        before = self.d().execute("select (select count(*) from public.jobs), (select count(*) from auth.users), (select count(*) from public.join_attempts)").fetchone()
        w = self.watch()
        self.assertEqual(list(w)[:5], ["jobs waiting now", "sign-ups in the last hour", "sign-ups not opened 20 minutes after (made 20 to 60 min ago)",
                                       "failed or needs-decision jobs in the last hour, by code", "sign-up size used (different addresses, last 24 hours)"], "the five rows, in order")
        self.assertEqual(w["jobs waiting now"][0], "0 waiting; oldest 0 min")
        self.assertEqual(w["failed or needs-decision jobs in the last hour, by code"][0], "none")
        self.assertEqual(w["sign-up size used (different addresses, last 24 hours)"][0], "0 of 200")
        self.assertEqual(w["sign-ups in the last hour"][0], "0")
        self.assertEqual(w["sign-ups not opened 20 minutes after (made 20 to 60 min ago)"][0], "0 of 0")
        self.assertEqual(w["scheduled job ops-tick"][0], "succeeded 1 min ago", "the LAST run, not an older failed one")
        self.assertEqual(w["scheduled job purge-partial-uploads"][0], "never ran")
        self.assertTrue(w["scheduled job cost-sync"][0].endswith("(NOT ACTIVE)"))
        # plant one case per row
        pid = self.d().execute("insert into public.projects (owner_id, title) values (%s, 'w') returning id", (core.RYAN,)).fetchone()[0]
        vid = self.d().execute("insert into public.versions (project_id, owner_id, number) values (%s, %s, 1) returning id", (pid, core.RYAN)).fetchone()[0]
        self.job(pid, vid, "queued", 45)
        self.job(pid, vid, "queued", 5)
        self.job(pid, vid, "failed", 10, "crash")
        self.job(pid, vid, "failed", 20, "crash")
        self.job(pid, vid, "editorial_action_required", 30, None)
        self.job(pid, vid, "failed", 90, "limit_exceeded")                      # outside the hour
        self.job(pid, vid, "complete", 10)                                       # not a failure
        self.d().execute("insert into auth.users (id, email, created_at, email_confirmed_at) values"
                         " (gen_random_uuid(), 'n1@x', now() - interval '30 minutes', null),"
                         " (gen_random_uuid(), 'n2@x', now() - interval '30 minutes', now() - interval '25 minutes'),"
                         " (gen_random_uuid(), 'n3@x', now() - interval '5 minutes', null),"
                         " (gen_random_uuid(), 'old@x', now() - interval '3 hours', null)")
        self.d().execute("insert into public.join_attempts (ip_hash, email_hash) values ('i1', repeat('1', 64)), ('i2', repeat('1', 64)), ('i3', repeat('2', 64))")
        self.d().execute("insert into public.join_attempts (ip_hash, email_hash, at) values ('i4', repeat('3', 64), now() - interval '25 hours')")
        self.d().execute("update public.ops_settings set join_daily_max = 10")
        w = self.watch()
        self.assertEqual(w["jobs waiting now"][0], "2 waiting; oldest 45 min")
        self.assertEqual(w["sign-ups in the last hour"][0], "3")
        self.assertEqual(w["sign-ups not opened 20 minutes after (made 20 to 60 min ago)"][0], "1 of 2", "the 5-minute-old one is too young to count, the 3-hour-old one too old")
        self.assertEqual(w["failed or needs-decision jobs in the last hour, by code"][0], "crash x2, no_code x1", "the 90-minute-old failure and the complete job are not counted")
        self.assertEqual(w["sign-up size used (different addresses, last 24 hours)"][0], "2 of 10", "one address twice counts once; 25 hours ago does not count")
        self.assertEqual(self.d().execute("select (select count(*) from public.jobs), (select count(*) from auth.users), (select count(*) from public.join_attempts)").fetchone(),
                         (before[0] + 7, before[1] + 4, before[2] + 4), "the watch itself wrote nothing")
        text = STEP58.read_text(encoding="utf-8").lower()
        for verb in ("insert ", "update ", "delete ", "alter ", "drop ", "truncate ", "grant "):
            self.assertNotIn(verb, text.split("select", 1)[1], "read-only: " + verb)

if __name__ == "__main__":
    unittest.main()
