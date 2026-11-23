"""Live step 65 (the welcome-credits watch, GEO 2026-11-23, CC1 17:48 LOW): each exclusion and the address normalising, one case each.

Verified in the last 24 hours, and none of them has a welcome record unless said:
  * a stranger                                  -> COUNTED (the one real alarm)
  * the render PC's login (public.workers)      -> not counted
  * an administrator (public.app_admins)        -> not counted
  * an invite-code account, by its redemption   -> not counted (its redemption row holds the address in lower case)
  * an invite-code account, by its metadata     -> not counted (adult_source 'invite')
  * '  Cap@Example.COM ' whose record was made from 'cap@example.com' -> not counted (lower + btrim, as the grant hashes it)
So the watch reads exactly 1; each exclusion removed would make it read 2 (must-fail).
Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_geo_welcome_watch_exclusions.py -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
STEP65 = core.ROOT / "live-steps" / "65_welcome_grant_watch.sql"


class WelcomeWatchExclusions(core.Base):
    def d(self):
        return self.db.as_(None).c

    def user(self, mail, meta="{}"):
        return self.d().execute("insert into auth.users (id, email, created_at, email_confirmed_at, raw_user_meta_data) values "
                                "(gen_random_uuid(), %s, now() - interval '1 hour', now() - interval '10 minutes', %s::jsonb) returning id",
                                (mail, meta)).fetchone()[0]

    def count(self):
        rows = self.d().execute(STEP65.read_text(encoding="utf-8")).fetchall()
        self.assertEqual(len(rows), 1)
        return rows[0][1].split(" ")[0]

    def test_GEO_65_counts_only_the_stranger(self):
        self.d().execute("update auth.users set created_at = now() - interval '3 days', email_confirmed_at = null")   # the template's users are not new sign-ups
        self.assertEqual(self.count(), "0")
        self.user("stranger@example.com")
        self.d().execute("update auth.users set email_confirmed_at = now() - interval '5 minutes' where id = %s", (core.WORKER,))
        admin = self.user("boss@example.com")
        self.d().execute("insert into public.app_admins (user_id) values (%s)", (admin,))
        self.d().execute("insert into public.invite_codes (code_hash, label, max_uses, expires_at) values (repeat('c', 64), 't', 5, now() + interval '1 day')")
        self.user("invited@example.com")
        self.d().execute("insert into public.invite_redemptions (code_hash, email, status) values (repeat('c', 64), 'invited@example.com', 'sent')")
        self.user("meta-invite@example.com", '{"adult_source": "invite"}')
        self.user("  Cap@Example.COM ")
        self.d().execute("insert into ryagram_private.welcome_credit_grants (email_hash) values "
                         "(encode(sha256(convert_to('ryagram-welcome:' || 'cap@example.com', 'UTF8')), 'hex'))")
        self.assertEqual(self.count(), "1", "the stranger only: the worker, the administrator, both invite accounts and the capitalised address with its record are left out")
        self.user("late@example.com")
        self.d().execute("update auth.users set email_confirmed_at = now() - interval '25 hours' where email = 'late@example.com'")
        self.assertEqual(self.count(), "1", "verified 25 hours ago is outside the window")


if __name__ == "__main__":
    unittest.main()
