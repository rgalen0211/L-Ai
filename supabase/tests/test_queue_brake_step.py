"""LIVE STEP 71, the queue brake (live-steps/71_queue_brake.sql; CC1 10:42 ruling), run part by part as Ryan will paste it, on a local Postgres
with every migration (the 2B ledger and the queue ceiling 20261124000100 included). BUILDER, 2026-11-24.

  * the file has exactly three parts; part 1 is read-only and works BEFORE the migration (brake 'off', no error) and after it
  * on a quiet database part 1 reads: brake off, 0 waiting by type, none waiting, the render PC never checked in
  * part 1 counts the line by type, the oldest wait, a fresh check-in, and leaves out a tester's own-computer job and a claimed one
  * part 2 as shipped sets 25: part 1 then shows 25, and the 26th new sheet is refused with the migration's own sentence
    (the header quotes that sentence word for word); a film already waiting is claimed as usual
  * part 2 before the migration fails with the column error the header tells Ryan about, and changes nothing
  * part 3 takes it off: part 1 shows off and the next sheet is accepted at once; nothing else in ops_settings moves
  * the files the header names exist
Run from the repo root with TEMP/TMP on D::
    <pgvenv>/Scripts/python -m unittest supabase/tests/test_queue_brake_step.py -v
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
import test_queue_ceiling as tqc  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
STEP71 = core.ROOT / "live-steps" / "71_queue_brake.sql"
REFUSAL = tqc.CEIL_WORDS


def setUpModule():
    credits.setUpModule()


def parts():
    """the three statements, split on the file's own '-- PART n' headers, exactly as Ryan pastes them"""
    chunks = re.split(r"^-- PART \d.*$", STEP71.read_text(encoding="utf-8"), flags=re.M)[1:]
    assert len(chunks) == 3, len(chunks)
    return [c.strip() for c in chunks]


class QueueBrakeStep(unittest.TestCase):
    tearDown = credits.Ledger.tearDown

    def setUp(self):
        credits.Ledger.setUp(self)
        self.admin("update ops_settings set auto_render = false returning 1")
    admin, version, submit = credits.Ledger.admin, credits.Ledger.version, credits.Ledger.submit
    claim = p1.Orders.claim
    ddl, refused = tqc.QueueCeiling.ddl, tqc.QueueCeiling.refused

    def run_part(self, sql):
        cur = self.db.as_(None).c.execute(sql)
        return cur.fetchall() if cur.description else None

    def read(self):
        return dict(self.run_part(parts()[0]))

    def settings(self):
        row = self.admin("select to_jsonb(s) - 'queue_ceiling' from ops_settings s where s.id")
        return row

    def test_three_parts_and_part_1_is_read_only(self):
        p = parts()
        self.assertTrue(p[0].lower().startswith("select"))
        self.assertIn("queue_ceiling = 25 where id;", p[1])
        self.assertIn("queue_ceiling = null where id;", p[2])
        before = self.settings()
        self.run_part(p[0])
        self.assertEqual(self.settings(), before)

    def test_quiet_database(self):
        self.assertEqual(self.read(), {
            "queue brake": "off",
            "jobs waiting for the render PC": "0 waiting: 0 sheets, 0 previews, 0 full films",
            "oldest waiting job made": "none waiting",
            "render PC last checked in": "never"})

    def test_part_1_counts_the_line(self):
        self.submit(self.version(), "contact_sheet")
        self.submit(self.version(), "contact_sheet")
        claimed = self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER)
        self.admin("update jobs set created_at = now() - interval '50 minutes' where id = %s returning 1",
                   self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER))
        self.admin("update jobs set state = 'claimed' where id = %s returning 1", claimed)
        local = self.submit(self.version(), "contact_sheet")
        self.ddl("set session_replication_role = replica")                   # fixture only: a tester's own-computer job (run_on is fixed at order time by a trigger)
        self.admin("update jobs set run_on = 'owner_local' where id = %s returning 1", local)
        self.ddl("set session_replication_role = origin")
        self.admin("update workers set last_seen_at = now() - interval '2 minutes' where user_id = %s returning 1", WORKER)
        r = self.read()
        self.assertEqual(r["jobs waiting for the render PC"], "3 waiting: 3 sheets, 0 previews, 0 full films", "claimed and own-computer jobs left out")
        self.assertEqual(r["oldest waiting job made"], "50 min ago")
        self.assertEqual(r["render PC last checked in"], "2 min ago")

    def test_part_2_sets_25_and_the_26th_is_refused_then_part_3_takes_it_off(self):
        self.admin("update ops_settings set queue_cap_per_owner = 50 returning 1")
        first = None
        for i in range(25):
            jid = self.submit(self.version(), "contact_sheet")
            first = first or jid
        before = self.settings()
        self.run_part(parts()[1])
        self.assertEqual(self.read()["queue brake"], "25")
        self.assertEqual(self.settings(), before, "part 2 changes nothing but the brake")
        self.refused(OTHER, tqc.SHEET, self.version(who=OTHER), words=REFUSAL, code="PTQUE")
        self.assertEqual(self.claim(), first, "a film already waiting is made as usual")
        self.assertIsNotNone(self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER), "one place freed by the claim")
        self.refused(OTHER, tqc.SHEET, self.version(who=OTHER), words=REFUSAL, code="PTQUE")
        self.run_part(parts()[2])
        self.assertEqual(self.read()["queue brake"], "off")
        self.assertEqual(self.settings(), before, "part 3 changes nothing but the brake")
        self.assertIsNotNone(self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER), "off: accepted at once")

    def test_before_the_migration_part_1_works_and_part_2_says_what_the_header_says(self):
        self.ddl(tqc.RB.read_text(encoding="utf-8"))
        self.assertEqual(self.read()["queue brake"], "off")
        with self.assertRaises(psycopg.Error) as cm:
            self.run_part(parts()[1])
        self.assertIn('column "queue_ceiling" of relation "ops_settings" does not exist', str(cm.exception))
        self.assertIn('column "queue_ceiling" of relation "ops_settings" does not exist', STEP71.read_text(encoding="utf-8"))
        self.db.c.execute("rollback") if self.db.c.info.transaction_status else None
        self.ddl(tqc.MIG.read_text(encoding="utf-8"))                              # then the header's 'once, before part 2'
        self.run_part(parts()[1])
        self.assertEqual(self.read()["queue brake"], "25")

    def test_the_header_quotes_the_real_sentence_and_names_real_files(self):
        text = STEP71.read_text(encoding="utf-8")
        self.assertIn(f"'{REFUSAL}'", text)
        self.assertIn(REFUSAL, tqc.MIG.read_text(encoding="utf-8"))
        for name in re.findall(r"supabase/(\S+?\.sql)", text):
            self.assertTrue((core.ROOT / name).exists(), name)
        self.assertIn("20261124000100_queue_ceiling.sql", text)
        self.assertIn("20261124000100_queue_ceiling_rollback.sql", text)


if __name__ == "__main__":
    unittest.main()
