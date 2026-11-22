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
        self.d().execute("insert into public.join_attempts (ip_hash, email_hash) select 'bulk' || g, repeat('a', 64) from generate_series(1, 200) g")
        self.assertEqual(self.join("z@example.com", "ipD"), {"ok": False, "reason": "throttled"}, "200 a day overall")

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

    def test_the_check_step_answers_true_on_every_row_with_the_flag_off_and_on(self):
        text = CHK.read_text(encoding="utf-8")
        for on in (False, True):
            self.flag(on)
            rows = self.d().execute(text).fetchall()
            self.assertEqual(len(rows), 6)
            self.assertTrue(all(r[1] is True for r in rows), rows)
            self.assertIn("OPEN" if on else "CLOSED", rows[-1][0])
        self.waiting(True)
        self.assertIn("waiting list", self.d().execute(text).fetchall()[-1][0], "with the brake on the last row says so")

    def test_the_rollback_puts_the_old_function_back_and_drops_the_flag(self):
        self.flag(True)
        self.d().execute(RB.read_text(encoding="utf-8"))
        self.assertEqual(self.join("a@example.com"), {"ok": False, "reason": "off"}, "the old function: closed whenever the waiting switch is off")
        self.waiting(True)
        self.assertEqual(self.join("b@example.com", "ip2"), {"ok": True})
        self.assertEqual(self.d().execute("select count(*) from information_schema.columns where table_name = 'ops_settings' and column_name = 'join_open'").fetchone()[0], 0)
        rows = self.d().execute(CHK.read_text(encoding="utf-8")).fetchall()
        self.assertEqual([r[1] for r in rows[:2]], [False, False], "after the undo the check answers false, never an error")
        self.assertIsNone(self.d().execute("select to_regclass('public.account_adult_confirmation')").fetchone()[0], "the 18+ table is gone")
        self.assertEqual(self.d().execute("select count(*) from pg_trigger where tgname = 'account_adult_new_trg'").fetchone()[0], 0)
        self.assertIsNone(self.d().execute("select to_regprocedure('ryagram_private.account_adult_new()')").fetchone()[0])
        self.waiting(False)
        self.assertEqual(self.signs_up(STRANGER2, 'after@example.com', {'adult_confirmed': 'true'}), ('active', True), 'sign-up still works after the undo')


if __name__ == "__main__":
    unittest.main()
