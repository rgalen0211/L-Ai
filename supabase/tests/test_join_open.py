"""SIGN-UP OPEN AT LAUNCH (migrations/20261121000800_join_open.sql, NOT APPLIED) on a local Postgres. CONNECT, 2026-11-21 (CC1's 12:4x order; WEB's proposals/WEB-SIGNUP-FLIP-1121.md option 2).

STATE: written 2026-11-21; see the run line in proposals/connect_join_open_done_1121*.txt for when it last ran and with what result. To run it from the repo root with TEMP/TMP on D: and RYAGRAM_LAI_REPO set:
    pgvenv/Scripts/python -m unittest supabase/tests/test_join_open.py -v
and kill any pgserver it leaves by PID (about 1 GB a run).

What it proves, each with the opposite case beside it
  * after the migration the flag is OFF and join answers 'off' exactly as before (waiting switch off); with the waiting switch ON and the flag off it still answers ok (the waiting list as today)
  * flag ON, waiting switch OFF: a stranger's join is allowed AND the account the signup makes is recorded ACTIVE (the account gate lets it in)
  * flag ON, waiting switch ON (the brake, live-step 20): the same join is allowed but the account is recorded WAITING and stays gated
  * the join limits still bite with the flag on: a bad address, the 6th from one caller in an hour, the 4th for one address in a day, the 200th overall
  * only the service role can run join_reserve; a signed-in person, anon and the connector login cannot; nobody but the dashboard can read or write the flag
  * an account made through the invite-code path (metadata adult_source = invite) is recorded with source invite; any other or missing source is join; a source alone records nothing
  * the check step answers true on every row with the flag off and on; the rollback puts the old function back (join answers 'off' again with the switch off) and drops the flag; the check then answers false, never an error
"""
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_film_card_requests as fc  # noqa: E402

setUpModule = core.setUpModule
RB = core.ROOT / "rollbacks" / "20261121000800_join_open_rollback.sql"
CHK = core.ROOT / "live-steps" / "46_join_open_check.sql"
STRANGER, STRANGER2 = (str(uuid.UUID(int=i)) for i in (701, 702))


class JoinOpen(core.Base):
    runner = fc.FilmCards.runner

    def d(self):
        return self.db.as_(None).c

    def flag(self, on):
        self.d().execute("update public.ops_settings set join_open = %s", (on,))

    def waiting(self, on):
        self.d().execute("update public.ops_settings set waiting_accounts = %s", (on,))

    def join(self, mail, ip="ip1"):
        return self.db.as_("service").one("select public.join_reserve(%s, %s)", mail, ip)

    def signs_up(self, uid, mail, meta=None):
        """what Supabase Auth does after the invite: a new auth.users row (the trigger records its status), carrying the invite's data as user metadata"""
        self.d().execute("insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (%s, %s, now(), %s::jsonb)", (uid, mail, None if meta is None else json.dumps(meta)))
        status = self.d().execute("select status from public.account_status where user_id = %s", (uid,)).fetchone()[0]
        active = self.d().execute("select ryagram_private.account_active(%s)", (uid,)).fetchone()[0]
        return status, active

    def test_off_after_the_migration_and_the_old_answers_hold(self):
        self.assertFalse(self.d().execute("select join_open from public.ops_settings").fetchone()[0])
        self.assertEqual(self.join("a@example.com"), {"ok": False, "reason": "off"}, "waiting switch off and flag off: join is closed, as today")
        self.waiting(True)
        self.assertEqual(self.join("a@example.com"), {"ok": True}, "the waiting list as today: join works while the switch is on")

    def test_flag_on_with_the_waiting_switch_off_a_stranger_joins_and_is_let_in(self):
        self.flag(True)
        self.assertEqual(self.join("new@example.com"), {"ok": True})
        self.assertEqual(self.signs_up(STRANGER, "new@example.com"), ("active", True), "recorded ACTIVE: the gate lets the stranger in")
        self.flag(False)
        self.assertEqual(self.join("other@example.com"), {"ok": False, "reason": "off"}, "turning the flag off closes join at once")

    def test_the_brake_still_works_with_the_flag_on(self):
        self.flag(True)
        self.waiting(True)                                              # live-step 20
        self.assertEqual(self.join("late@example.com"), {"ok": True})
        self.assertEqual(self.signs_up(STRANGER, "late@example.com"), ("waiting", False), "the brake: the same join now lands on the waiting list and stays gated")
        self.waiting(False)                                             # live-step 21: back to open
        self.assertEqual(self.join("later@example.com", "ip2"), {"ok": True})
        self.assertEqual(self.signs_up(STRANGER2, "later@example.com"), ("active", True))
        self.assertEqual(self.d().execute("select status from public.account_status where user_id = %s", (STRANGER,)).fetchone()[0], "waiting", "the account that waited keeps waiting: the brake is not undone for it")

    def test_the_join_limits_still_bite_with_the_flag_on(self):
        self.flag(True)
        self.assertEqual(self.join("not an email"), {"ok": False, "reason": "email"})
        for i in range(5):
            self.assertTrue(self.join(f"p{i}@example.com", "ipA")["ok"])
        self.assertEqual(self.join("p9@example.com", "ipA"), {"ok": False, "reason": "throttled"}, "the 6th from one caller in an hour")
        for i in range(3):
            self.assertTrue(self.join("same@example.com", f"ipB{i}")["ok"])
        self.assertEqual(self.join("SAME@example.com", "ipC"), {"ok": False, "reason": "throttled"}, "the 4th for one address in a day")
        self.d().execute("insert into public.join_attempts (ip_hash, email_hash) select 'bulk' || g, encode(sha256(convert_to('bulk' || g, 'UTF8')), 'hex') from generate_series(1, 200) g")
        self.assertEqual(self.join("z@example.com", "ipD"), {"ok": False, "reason": "full"}, "200 different addresses in any 24 hours: the day is FULL (its own answer, nobody blamed)")

    def test_who_can_run_it_and_who_can_touch_the_flag(self):
        for who in ("anon", STRANGER):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.join_reserve('a@example.com', 'ip1')")
        with self.assertRaises(psycopg.Error):
            self.runner().one("select public.join_reserve('a@example.com', 'ip1')")
        for who in ("anon", STRANGER, "service"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select join_open from public.ops_settings")
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute("update public.ops_settings set join_open = true")
        self.assertFalse(self.d().execute("select join_open from public.ops_settings").fetchone()[0], "nobody but the dashboard changed it")

    def adult(self, uid):
        return self.d().execute("select source, confirmed_at <= now() and confirmed_at > now() - interval '1 minute' from public.account_adult_confirmation where user_id = %s", (uid,)).fetchone()

    def test_the_18_plus_confirmation_is_recorded_with_the_account_that_carries_it(self):
        self.signs_up(STRANGER, "yes@example.com", {"adult_confirmed": "true"})
        self.assertEqual(self.adult(STRANGER), ("join", True), "recorded with its source and the moment the account was made")
        for i, meta in enumerate((None, {}, {"adult_confirmed": "false"}, {"adult_confirmed": "yes"}, {"other": "true"})):
            uid = str(uuid.UUID(int=720 + i))
            self.signs_up(uid, f"no{i}@example.com", meta)
            self.assertIsNone(self.adult(uid), "no row without the confirmation: " + str(meta))

    def test_an_account_made_through_an_invite_code_is_recorded_with_source_invite(self):
        self.signs_up(STRANGER, "code@example.com", {"adult_confirmed": "true", "adult_source": "invite"})
        self.assertEqual(self.adult(STRANGER), ("invite", True))
        self.signs_up(STRANGER2, "odd@example.com", {"adult_confirmed": "true", "adult_source": "something-else"})
        self.assertEqual(self.adult(STRANGER2), ("join", True), "an unknown source falls back to join: the table only ever holds the two")
        other = str(uuid.UUID(int=730))
        self.signs_up(other, "nobox@example.com", {"adult_source": "invite"})
        self.assertIsNone(self.adult(other), "a source without the confirmation records nothing")

    def test_a_later_change_of_the_metadata_cannot_change_the_record(self):
        self.signs_up(STRANGER, "yes@example.com", {"adult_confirmed": "true"})
        before = self.d().execute("select confirmed_at from public.account_adult_confirmation where user_id = %s", (STRANGER,)).fetchone()[0]
        self.d().execute("update auth.users set raw_user_meta_data = '{}'::jsonb where id = %s", (STRANGER,))
        self.d().execute("update auth.users set raw_user_meta_data = '{\"adult_confirmed\":\"true\"}'::jsonb where id = %s", (STRANGER,))
        self.assertEqual(self.d().execute("select count(*), min(confirmed_at) from public.account_adult_confirmation where user_id = %s", (STRANGER,)).fetchone(), (1, before))
        self.signs_up(STRANGER2, "late@example.com", None)
        self.d().execute("update auth.users set raw_user_meta_data = '{\"adult_confirmed\":\"true\"}'::jsonb where id = %s", (STRANGER2,))
        self.assertIsNone(self.adult(STRANGER2), "a person who edits their own metadata afterwards gets no record: only the moment the account is made counts")

    def test_the_record_table_is_closed_to_every_api_role_and_a_deleted_account_takes_its_row(self):
        self.signs_up(STRANGER, "yes@example.com", {"adult_confirmed": "true"})
        for who in ("anon", STRANGER, "service"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select count(*) from public.account_adult_confirmation")
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute("insert into public.account_adult_confirmation (user_id, source) values (gen_random_uuid(), 'join')")
        self.d().execute("delete from auth.users where id = %s", (STRANGER,))
        self.assertIsNone(self.adult(STRANGER), "the row goes with the account")

    def test_a_failure_to_record_never_stops_the_sign_up(self):
        self.d().execute("alter table public.account_adult_confirmation add constraint boom check (false) not valid")
        self.assertEqual(self.signs_up(STRANGER, "yes@example.com", {"adult_confirmed": "true"}), ("active", True), "the account is made and open")
        self.assertIsNone(self.adult(STRANGER))
        self.d().execute("alter table auth.users drop column raw_user_meta_data")
        self.assertEqual(self.d().execute("insert into auth.users (id, email) values (%s, 'nometa@example.com') returning 1", (STRANGER2,)).fetchone()[0], 1, "not even a missing metadata column stops a sign-up")

    def test_the_daily_size_is_a_setting_with_default_200_and_zero_shuts_sign_up(self):
        """CC1's ruling 11-23: ops_settings.join_daily_max (default 200). The overall size of sign-up in any 24 hours; a full day answers 'full', checked BEFORE the per-caller limits so nobody is told they tried too often."""
        self.flag(True)
        self.assertEqual(self.d().execute("select join_daily_max from public.ops_settings").fetchone()[0], 200, "the default is the number that was always there")
        self.d().execute("update public.ops_settings set join_daily_max = 3")
        for i in range(3):
            self.assertEqual(self.join(f"s{i}@example.com", f"ip{i}"), {"ok": True})
        self.assertEqual(self.join("s9@example.com", "ip9"), {"ok": False, "reason": "full"}, "the 4th in the day with a size of 3")
        self.assertEqual(self.join("s0@example.com", "ip0"), {"ok": False, "reason": "full"}, "a repeat caller is told the day is full too, never that they tried too often")
        self.d().execute("update public.ops_settings set join_daily_max = 4")
        self.assertEqual(self.join("s9@example.com", "ip9"), {"ok": True}, "raising the number lets the next one in at once")
        self.d().execute("update public.ops_settings set join_daily_max = 0")
        self.assertEqual(self.join("t@example.com", "ipT"), {"ok": False, "reason": "full"}, "0 shuts sign-up for everyone")
        self.d().execute("update public.join_attempts set at = now() - interval '25 hours'")
        self.d().execute("update public.ops_settings set join_daily_max = 5")
        self.assertEqual(self.join("t@example.com", "ipT"), {"ok": True}, "attempts older than 24 hours do not count")
        with self.assertRaises(psycopg.Error):
            self.d().execute("update public.ops_settings set join_daily_max = -1")
        for who in ("anon", STRANGER, "service"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select join_daily_max from public.ops_settings")
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("update public.ops_settings set join_daily_max = 5000 returning 1")
        self.waiting(False)
        self.flag(False)
        self.assertEqual(self.join("u@example.com", "ipU"), {"ok": False, "reason": "off"}, "closed stays 'off' whatever the size")

    def test_the_daily_size_counts_people_not_tries(self):
        """GAMES 09:21: Ryan thinks in people. The same address pressing Send again, and the step-5 test join, use one place, not three."""
        self.flag(True)
        self.d().execute("update public.ops_settings set join_daily_max = 3")
        for i in range(3):
            self.assertEqual(self.join("same@example.com", f"ipS{i}"), {"ok": True})
        self.assertEqual(self.join("same@example.com", "ipS9"), {"ok": False, "reason": "throttled"}, "the per-address limit of 3 a day still bites (its own words)")
        self.assertEqual(self.join("b@example.com", "ipB"), {"ok": True}, "three tries from ONE person took one place of 3")
        self.assertEqual(self.join("c@example.com", "ipC"), {"ok": True})
        self.assertEqual(self.join("d@example.com", "ipD"), {"ok": False, "reason": "full"}, "the 4th person")

    def test_the_check_step_answers_true_on_every_row_with_the_flag_off_and_on(self):
        text = CHK.read_text(encoding="utf-8")
        for on in (False, True):
            self.flag(on)
            rows = self.d().execute(text).fetchall()
            self.assertEqual(len(rows), 8)
            self.assertTrue(all(r[1] is True for r in rows), rows)
            self.assertIn("OPEN" if on else "CLOSED", rows[-1][0])
        self.waiting(True)
        self.assertIn("waiting list", self.d().execute(text).fetchall()[-1][0], "with the brake on the last row says so")

    def test_a_failed_email_send_gives_the_try_back_and_only_that_one(self):
        """11-23 (CC1's audit of the email path): the join function calls join_release after a failed send. It deletes the ONE newest try of this caller and address, so honest retries on a launch morning are not locked out
        (3 a day per address), and it never touches another address's tries, another caller's, or older ones. Service role only."""
        self.flag(True)
        rel = lambda mail, ip="ip1": self.db.as_("service").one("select public.join_release(%s, %s)", mail, ip)
        count = lambda mail=None: self.d().execute("select count(*) from public.join_attempts" + ("" if mail is None else " where email_hash = encode(sha256(convert_to('ryagram-join:' || %s, 'UTF8')), 'hex')"), () if mail is None else (mail,)).fetchone()[0]
        for _ in range(3):
            self.assertEqual(self.join("a@example.com"), {"ok": True})
        self.assertEqual(self.join("a@example.com"), {"ok": False, "reason": "throttled"}, "three tries an address a day")
        rel("a@example.com")
        self.assertEqual(count("a@example.com"), 2, "one try given back, only one")
        self.assertEqual(self.join("a@example.com"), {"ok": True}, "and the person can try again")
        self.assertEqual(self.join("b@example.com", "ip2"), {"ok": True})
        rel("a@example.com", "ip2")                                                              # a different caller: nothing of a@ with ip1 is touched
        self.assertEqual(count("a@example.com"), 3)
        rel("b@example.com", "ip1")                                                              # same address, other caller: untouched
        self.assertEqual(count("b@example.com"), 1)
        self.d().execute("update public.join_attempts set at = now() - interval '1 hour'")      # older than 10 minutes: not given back
        rel("a@example.com")
        self.assertEqual(count("a@example.com"), 3)
        rel("nobody@example.com")                                                                # no try on record: nothing happens, no error
        for who in ("anon", STRANGER):
            with self.assertRaises(psycopg.Error, msg=str(who)):
                self.db.as_(who).one("select public.join_release('a@example.com', 'ip1')")

    def test_the_stuck_redemption_check_lists_a_redemption_whose_mail_went_out_but_was_never_recorded_and_its_repair_works(self):
        """GAMES' review 11-23 of redeem-invite: if the mail went out but invite_sent kept failing, the redemption stays 'pending' while the person has an account. Live step 53 lists those (read-only) with the repair statement."""
        chk = (core.ROOT / "live-steps" / "53_stuck_invite_redemptions_check.sql").read_text(encoding="utf-8")
        self.d().execute("insert into public.invite_codes (code_hash, label, max_uses, expires_at) values (repeat('a', 64), 'test', 5, now() + interval '1 day')")
        self.waiting(False)
        self.signs_up(STRANGER, "stuck@example.com", {"adult_confirmed": "true", "adult_source": "invite"})
        self.d().execute("insert into public.invite_redemptions (code_hash, email, status, created_at) values (repeat('a', 64), 'stuck@example.com', 'pending', now() - interval '20 minutes')")
        self.d().execute("insert into public.invite_redemptions (code_hash, email, status, created_at) values (repeat('a', 64), 'young@example.com', 'pending', now() - interval '1 minute')")
        self.d().execute("insert into public.invite_redemptions (code_hash, email, status, created_at) values (repeat('a', 64), 'noaccount@example.com', 'pending', now() - interval '30 minutes')")
        # a pending row YOUNGER than 10 minutes whose email already has an account is still in flight: not listed, not counted
        self.signs_up(STRANGER2, "inflight@example.com", {"adult_confirmed": "true", "adult_source": "invite"})
        self.d().execute("insert into public.invite_redemptions (code_hash, email, status, created_at) values (repeat('a', 64), 'inflight@example.com', 'pending', now() - interval '2 minutes')")
        # a RELEASED row (no mail went out) with an account made later: never listed, invite_sent cannot repair it
        self.signs_up(str(uuid.UUID(int=706)), "released@example.com", {"adult_confirmed": "true", "adult_source": "invite"})
        self.d().execute("insert into public.invite_redemptions (code_hash, email, status, created_at) values (repeat('a', 64), 'released@example.com', 'released', now() - interval '30 minutes')")
        rows = self.d().execute(chk).fetchall()
        self.assertEqual(len(rows), 2, rows)
        self.assertEqual(rows[0][1], "1", "one stuck: old enough and the email has an account (the young one and the one without an account are not listed)")
        self.assertEqual(rows[1][2], "stuck@example.com")
        repair = rows[1][5]
        self.assertIn("select public.invite_sent(", repair)
        self.d().execute(repair)
        self.assertEqual(self.d().execute("select status from public.invite_redemptions where email = 'stuck@example.com'").fetchone()[0], "sent", "the repair statement records it")
        self.d().execute(repair)                                                                  # twice is harmless
        rows = self.d().execute(chk).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][1], "0", "nothing stuck after the repair")

    def test_the_stuck_redemption_check_never_lists_a_second_row_an_old_account_or_an_email_already_sent(self):
        """GEO's review 11-23 (two MEDIUM): invite_sent grants the code's credits every time it runs on a pending row, and activates whatever account the email has. So the check lists only the NEWEST pending row of an email,
        leaves out an email that already has a 'sent' redemption, and leaves out an account that existed BEFORE the redemption (not the person just invited)."""
        chk = (core.ROOT / "live-steps" / "53_stuck_invite_redemptions_check.sql").read_text(encoding="utf-8")
        self.d().execute("insert into public.invite_codes (code_hash, label, max_uses, expires_at) values (repeat('a', 64), 'test', 9, now() + interval '1 day')")
        self.waiting(False)
        ins = "insert into public.invite_redemptions (code_hash, email, status, created_at) values (repeat('a', 64), %s, %s, now() - make_interval(mins => %s))"
        # 1. two pending rows for one email, both old: only the newest is listed (one repair = one grant)
        self.signs_up(STRANGER, "twice@example.com", {"adult_confirmed": "true", "adult_source": "invite"})
        self.d().execute(ins, ("twice@example.com", "pending", 60))
        self.d().execute(ins, ("twice@example.com", "pending", 30))
        # 2. an older 'sent' row plus a pending one: nothing to repair, a repair would grant a second time
        self.signs_up(STRANGER2, "sentbefore@example.com", {"adult_confirmed": "true", "adult_source": "invite"})
        self.d().execute(ins, ("sentbefore@example.com", "sent", 90))
        self.d().execute(ins, ("sentbefore@example.com", "pending", 40))
        # 3. an account that existed BEFORE the redemption (the redeem-invite release failed after email_exists): not the person just invited
        self.d().execute("insert into auth.users (id, email, created_at) values (%s, 'old@example.com', now() - interval '3 days')", (str(uuid.UUID(int=703)),))
        self.d().execute(ins, ("old@example.com", "pending", 50))
        rows = self.d().execute(chk).fetchall()
        self.assertEqual(len(rows), 2, rows)
        self.assertEqual(rows[0][1], "1", "one email is stuck: the one with two pending rows")
        self.assertEqual(rows[1][2], "twice@example.com")
        newest = self.d().execute("select id from public.invite_redemptions where email = 'twice@example.com' order by created_at desc limit 1").fetchone()[0]
        self.assertEqual(rows[1][1], str(newest), "the NEWEST pending row is the one listed")
        self.d().execute(rows[1][5])
        self.assertEqual(self.d().execute("select count(*) from public.invite_redemptions where email = 'twice@example.com' and status = 'sent'").fetchone()[0], 1)
        rows = self.d().execute(chk).fetchall()
        self.assertEqual(rows[0][1], "0", "after the repair the older pending row is not listed either (the email now has a sent redemption)")

    def test_the_rollback_puts_the_old_function_back_and_drops_the_flag(self):
        self.flag(True)
        self.d().execute(RB.read_text(encoding="utf-8"))
        self.assertEqual(self.join("a@example.com"), {"ok": False, "reason": "off"}, "the old function: closed whenever the waiting switch is off")
        self.waiting(True)
        self.assertEqual(self.join("b@example.com", "ip2"), {"ok": True})
        self.assertEqual(self.d().execute("select count(*) from information_schema.columns where table_name = 'ops_settings' and column_name = 'join_open'").fetchone()[0], 0)
        rows = self.d().execute(CHK.read_text(encoding="utf-8")).fetchall()
        self.assertEqual([r[1] for r in rows[:2]], [False, False], "after the undo the check answers false, never an error")
        self.assertEqual(self.d().execute("select count(*) from information_schema.columns where table_name = 'ops_settings' and column_name = 'join_daily_max'").fetchone()[0], 0, "the daily size column is gone")
        self.assertIsNone(self.d().execute("select to_regprocedure('public.join_release(text,text)')").fetchone()[0], "the release function is gone")
        self.assertIsNone(self.d().execute("select to_regclass('public.account_adult_confirmation')").fetchone()[0], "the 18+ table is gone")
        self.assertEqual(self.d().execute("select count(*) from pg_trigger where tgname = 'account_adult_new_trg'").fetchone()[0], 0)
        self.assertIsNone(self.d().execute("select to_regprocedure('ryagram_private.account_adult_new()')").fetchone()[0])
        self.waiting(False)
        self.assertEqual(self.signs_up(STRANGER2, 'after@example.com', {'adult_confirmed': 'true'}), ('active', True), 'sign-up still works after the undo')


if __name__ == "__main__":
    unittest.main()
