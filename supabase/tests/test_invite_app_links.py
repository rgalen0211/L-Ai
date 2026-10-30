"""The app link in the invite email (migrations/20261030000100_invite_app_links.sql, NEXT-CONNECT 162, NOT APPLIED) on a local Postgres.

Same setup as test_invite_email.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_invite_app_links.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * only an admin can make a link, only for an invite that was SENT and is still usable, and only while an active app release exists; the token comes back ONCE and only its SHA-256 is stored
  * peek changes nothing; redeem uses the link up in one step (a second redeem, an expired link, a disabled invite, a made-up or malformed token are all refused and nothing is marked)
  * a newer link for the same invite replaces an older unused one; a used link is kept as a record
  * the link lives at most 7 days, and never longer than the invite code
  * redeem hands back the release exactly as request_app_download does (900 seconds) and writes NO app_downloads row
  * peek and redeem are the service role's alone; the table is closed to every API role
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2b_credits as credits  # noqa: E402
import test_creator_flow as flow  # noqa: E402

RYAN, OTHER = flow.RYAN, flow.OTHER
setUpModule = flow.setUpModule
SHA = "b" * 64
KEYS = {"kind", "file_name", "size_bytes", "sha256", "object_key", "expires_seconds"}


class InviteAppLinks(unittest.TestCase):
    setUp, tearDown = credits.Ledger.setUp, credits.Ledger.tearDown
    admin, denied = credits.Ledger.admin, credits.Ledger.denied
    make_ryan_admin, ryan, svc = flow.CreatorFlow.make_ryan_admin, flow.CreatorFlow.ryan, flow.CreatorFlow.svc

    def invite(self, name="Maya Ortiz"):
        return self.ryan().one("select admin_invite_person(%s, null)", name)

    def sent(self, name="Maya Ortiz"):
        code = self.invite(name)
        self.ryan().one("select admin_invite_send_begin(%s, 'maya@example.com')", code)
        return code

    def release(self, active=True):
        self.admin("insert into public.app_releases (kind, file_name, size_bytes, sha256, object_key, active) values ('app', 'app-9.zip', 274327789, %s, 'releases/app-9.zip', %s) returning 1", SHA, active)

    def make(self, code):
        return self.ryan().one("select admin_invite_app_link_make(%s)", code)

    def th(self, token):
        return self.admin("select encode(sha256(convert_to(%s, 'UTF8')), 'hex')", token)

    def test_an_admin_makes_a_link_for_a_sent_invite_and_only_its_hash_is_kept(self):
        self.make_ryan_admin()
        self.release()
        code = self.sent()
        r = self.make(code)
        self.assertRegex(r["token"], "^[0-9a-f]{64}$")
        self.assertEqual(self.admin("select count(*) from public.invite_app_links"), 1)
        self.assertEqual(self.admin("select token_hash from public.invite_app_links"), self.th(r["token"]))
        self.assertEqual(self.admin("select count(*) from public.invite_app_links where token_hash = %s", r["token"]), 0)        # the token itself is nowhere
        self.assertIsNone(self.admin("select used_at from public.invite_app_links"))
        self.assertTrue(self.admin("select expires_at <= now() + interval '7 days' and expires_at > now() + interval '6 days' from public.invite_app_links"))

    def test_the_link_never_outlives_the_invite_code(self):
        self.make_ryan_admin()
        self.release()
        code = self.sent()
        self.admin("update public.invite_codes set expires_at = now() + interval '2 days' where label = 'invite: Maya Ortiz' returning 1")
        self.make(code)
        self.assertTrue(self.admin("select expires_at <= now() + interval '2 days' + interval '1 minute' from public.invite_app_links"))

    def test_peek_changes_nothing_and_redeem_uses_the_link_up_in_one_step(self):
        self.make_ryan_admin()
        self.release()
        token = self.make(self.sent())["token"]
        h = self.th(token)
        for _ in range(3):
            p = self.svc().one("select peek_invite_app_link(%s)", h)
            self.assertEqual((p["ok"], p["file_name"], p["size_bytes"]), (True, "app-9.zip", 274327789))
        self.assertIsNone(self.admin("select used_at from public.invite_app_links"))
        got = self.svc().one("select redeem_invite_app_link(%s)", h)
        self.assertEqual(set(got), KEYS)
        self.assertEqual((got["file_name"], got["sha256"], got["object_key"], got["expires_seconds"], got["kind"]), ("app-9.zip", SHA, "releases/app-9.zip", 900, "app"))
        self.assertIsNotNone(self.admin("select used_at from public.invite_app_links"))
        with self.assertRaises(psycopg.Error) as cm:
            self.svc().one("select redeem_invite_app_link(%s)", h)                               # one time only
        self.assertEqual(cm.exception.sqlstate, "PT404")
        self.assertEqual(self.svc().one("select peek_invite_app_link(%s)", h), {"ok": False})
        self.assertEqual(self.admin("select count(*) from public.app_downloads"), 0)             # that table belongs to signed-in accounts

    def test_a_made_up_malformed_expired_or_disabled_link_is_refused_and_nothing_is_marked(self):
        self.make_ryan_admin()
        self.release()
        token = self.make(self.sent())["token"]
        h = self.th(token)
        for bad in ("0" * 64, "nope", "", "G" * 64, h.upper(), h + "0", token):                  # the TOKEN itself is not the hash
            with self.assertRaises(psycopg.Error, msg=bad) as cm:
                self.svc().one("select redeem_invite_app_link(%s)", bad)
            self.assertEqual(cm.exception.sqlstate, "PT404", bad)
            self.assertEqual(self.svc().one("select peek_invite_app_link(%s)", bad), {"ok": False}, bad)
        with self.assertRaises(psycopg.Error):
            self.svc().one("select redeem_invite_app_link(null)")
        self.admin("update public.invite_app_links set expires_at = now() - interval '1 second', created_at = now() - interval '1 day' returning 1")
        with self.assertRaises(psycopg.Error):
            self.svc().one("select redeem_invite_app_link(%s)", h)
        self.assertEqual(self.svc().one("select peek_invite_app_link(%s)", h), {"ok": False})
        self.admin("update public.invite_app_links set expires_at = now() + interval '1 day' returning 1")
        self.assertTrue(self.svc().one("select peek_invite_app_link(%s)", h)["ok"])                # control: good again
        self.admin("update public.invite_codes set disabled = true where label = 'invite: Maya Ortiz' returning 1")
        with self.assertRaises(psycopg.Error):
            self.svc().one("select redeem_invite_app_link(%s)", h)                               # a disabled invite kills its link
        self.assertEqual(self.svc().one("select peek_invite_app_link(%s)", h), {"ok": False})
        self.assertIsNone(self.admin("select used_at from public.invite_app_links"))             # none of the refusals marked it used

    def test_no_active_release_means_no_link_and_no_redeem(self):
        self.make_ryan_admin()
        code = self.sent()
        with self.assertRaisesRegex(psycopg.Error, "not ready yet"):
            self.make(code)
        self.release()
        token = self.make(code)["token"]
        self.admin("update public.app_releases set active = false returning 1")
        with self.assertRaises(psycopg.Error):
            self.svc().one("select redeem_invite_app_link(%s)", self.th(token))
        self.assertEqual(self.svc().one("select peek_invite_app_link(%s)", self.th(token)), {"ok": False})
        self.assertIsNone(self.admin("select used_at from public.invite_app_links"))

    def test_a_newer_link_replaces_an_older_unused_one_and_a_used_one_is_kept_as_a_record(self):
        self.make_ryan_admin()
        self.release()
        code = self.sent()
        first = self.make(code)["token"]
        second = self.make(code)["token"]
        self.assertNotEqual(first, second)
        self.assertEqual(self.admin("select count(*) from public.invite_app_links"), 1)
        with self.assertRaises(psycopg.Error):
            self.svc().one("select redeem_invite_app_link(%s)", self.th(first))                  # the old one is gone
        self.svc().one("select redeem_invite_app_link(%s)", self.th(second))
        third = self.make(code)["token"]
        self.assertEqual(self.admin("select count(*) from public.invite_app_links"), 2)           # the used one stays (a record), the new one is separate
        self.assertTrue(self.svc().one("select peek_invite_app_link(%s)", self.th(third))["ok"])

    def test_only_an_admin_can_make_a_link_and_only_for_a_sent_usable_invite(self):
        self.make_ryan_admin()
        self.release()
        code = self.invite()                                                                      # made but NOT sent
        with self.assertRaisesRegex(psycopg.Error, "Send the invite first"):
            self.make(code)
        self.ryan().one("select admin_invite_send_begin(%s, 'maya@example.com')", code)
        for who in ("anon", OTHER, "service"):
            self.denied(who, "select admin_invite_app_link_make(%s)", code)
        self.assertEqual(self.admin("select count(*) from public.invite_app_links"), 0)
        with self.assertRaisesRegex(psycopg.Error, "not one you can send"):
            self.make("RYA-ZZZZ-ZZZZ")
        creator = self.admin("select public.invite_issue('creator #7 Someone', 1, 30)")
        with self.assertRaisesRegex(psycopg.Error, "not one you can send"):
            self.make(creator)
        used, lapsed, off = self.sent("Used"), self.sent("Lapsed"), self.sent("Off")
        self.admin("update public.invite_codes set uses = 1 where label = 'invite: Used' returning 1")
        self.admin("update public.invite_codes set expires_at = now() - interval '1 day' where label = 'invite: Lapsed' returning 1")
        self.admin("update public.invite_codes set disabled = true where label = 'invite: Off' returning 1")
        for c in (used, lapsed, off):
            with self.assertRaisesRegex(psycopg.Error, "expired or was already used"):
                self.make(c)
        self.assertEqual(self.admin("select count(*) from public.invite_app_links"), 0)

    def test_peek_and_redeem_are_the_service_roles_alone_and_the_table_is_closed(self):
        self.make_ryan_admin()
        self.release()
        h = self.th(self.make(self.sent())["token"])
        for who in (RYAN, OTHER, "anon"):
            self.denied(who, "select peek_invite_app_link(%s)", h)
            self.denied(who, "select redeem_invite_app_link(%s)", h)
        for who in (RYAN, OTHER, "anon", "service"):
            self.denied(who, "select * from public.invite_app_links")
        self.assertIsNone(self.admin("select used_at from public.invite_app_links"))

    def test_the_link_goes_with_its_invite_code(self):
        self.make_ryan_admin()
        self.release()
        self.make(self.sent("Old One"))
        self.admin("update public.invite_codes set expires_at = now() - interval '13 months' where label = 'invite: Old One' returning 1")
        self.svc().one("select retention_purge()")
        self.assertEqual(self.admin("select count(*) from public.invite_app_links"), 0)


if __name__ == "__main__":
    unittest.main()
