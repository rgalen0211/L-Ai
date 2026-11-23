"""The Wednesday live steps GEO owns (LAUNCH-LIVE-STEPS section 00), on a local Postgres with every migration. GEO 2026-11-23.

  * live-steps/53_invite_pending_check.sql lists an invite redemption still 'pending' after 10 minutes whose email already has an
    account, and its repair_sql cell really repairs it (then the row is gone and the account is active); a fresh redemption and one
    whose email has no account are not listed.
Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_wed_live_steps.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
CHECK53 = core.ROOT / "live-steps" / "53_invite_pending_check.sql"


class WedLiveSteps(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def rows53(self):
        return self.db.as_(None).c.execute(CHECK53.read_text(encoding="utf-8")).fetchall()

    def test_GEO_53_lists_a_stuck_invite_and_its_repair_line_really_repairs_it(self):
        code = "c" * 64
        self.admin("insert into invite_codes (code_hash, label, max_uses, expires_at) values (%s, 'test', 5, now() + interval '1 day') returning 1", code)
        stuck, fresh, nobody = uuid.uuid4(), uuid.uuid4(), "nobody@x"
        self.admin("insert into auth.users (id, email) values (%s, 'stuck@x'), (%s, 'fresh@x') returning 1", stuck, fresh)
        old = self.admin("insert into invite_redemptions (code_hash, email, status, created_at) values (%s, 'Stuck@X', 'pending', now() - interval '20 minutes') returning id", code)
        self.admin("insert into invite_redemptions (code_hash, email, status) values (%s, 'fresh@x', 'pending') returning id", code)
        self.admin("insert into invite_redemptions (code_hash, email, status, created_at) values (%s, %s, 'pending', now() - interval '20 minutes') returning id", code, nobody)
        rows = self.rows53()
        self.assertEqual([(r[0], r[2]) for r in rows], [(old, stuck)])        # only the old one whose address has an account (any case)
        repair = rows[0][3]
        self.assertEqual(repair, f"select public.invite_sent({old}, '{stuck}');")
        self.db.as_(None).c.execute(repair)
        self.assertEqual(self.rows53(), [])                                   # repaired: gone from the check
        self.assertEqual(self.admin("select status from invite_redemptions where id = %s", old), "sent")
        self.assertEqual(self.admin("select status from account_status where user_id = %s", stuck), "active")


if __name__ == "__main__":
    unittest.main()
