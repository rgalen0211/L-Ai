"""THE PERFECT CITY NUMBERS FOR A SPOT, FOR THE PERSON'S AI (migrations/20261127000500_connect_perfect_city_summary.sql, NOT APPLIED) on a local Postgres. CONNECT 2026-11-27. WRITTEN, NOT RUN (one Postgres at a time across the sessions).

Same setup as test_connect_compilation_status.py (its helpers are borrowed, the OAuth dance included). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_perfect_city_summary.py -v

GEO's helper ryagram_private.perfect_city_summary_for is NOT in this repo's template yet (it is in GEO's migration 20261127000900), so the test creates a STAND-IN with the same name, arguments and refusals (42501 without the switch, 22023 for an unknown county,
a rounded spot) that ECHOES the owner it was given. The stand-in proves only what THIS function does: whom it passes, what it checks first, what it lets through. GEO's own test proves the numbers.

Rules proved (each with a control that passes and a fault that must be refused)
  * before GEO's helper exists the call says 'Perfect City is not available yet.' (PT503) and nothing else; once it exists it answers
  * the helper is given the TOKEN'S OWN person (never an argument), so each person gets their own answer; a helper's 42501 (switch off) and 22023 (unknown county) reach the caller as the helper's sentence
  * arguments are checked in plain words BEFORE the helper runs: a missing or oddly written place or kind, a latitude or longitude that is missing or out of range (22023)
  * (M2, 11-27) the twin itself refuses 42501 unless the person has the perfectCity switch or is an app admin, before the helper is looked for: a trap helper proves it is never called without the switch
  * a token that is not valid is refused (PT401) and the function takes no owner argument; nothing is written by any call
  * only the connector login can run it, and (a control on the stand-in, as on GEO's real helper) the connector login cannot run the helper directly
  * the migration adds one function and ends with the gate; the after-check is all true; the rollback removes exactly this function and not the helper
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_compilation_requests as tcr  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

MIG = core.ROOT / "migrations" / "20261127000500_connect_perfect_city_summary.sql"
RB = core.ROOT / "rollbacks" / "20261127000500_connect_perfect_city_summary_rollback.sql"
CHECK = core.ROOT / "live-steps" / "66b_connect_perfect_city_summary_check.sql"
SIG = "public.connect_perfect_city_summary(text, text, text, double precision, double precision)"
HELPER_SIG = "ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)"
# the stand-in for GEO's private helper: the same name, arguments and refusals, and it hands back the owner it was given so the test can see whom the twin passed. Revoked from public like GEO's must be.
HELPER = """create function ryagram_private.perfect_city_summary_for(p_owner uuid, p_county text, p_kind text, p_lat double precision, p_lon double precision) returns jsonb
language plpgsql stable as $f$
begin
  if not exists (select 1 from public.account_settings s where s.owner_id = p_owner and 'perfectCity' = any (s.switches_on)) then
    raise exception 'Perfect City is not switched on for this account.' using errcode = '42501';
  end if;
  if p_county not in ('montgomery_oh', 'greene_oh') then
    raise exception 'Choose a county: montgomery_oh or greene_oh.' using errcode = '22023';
  end if;
  return jsonb_build_object('schema', 'ryagram.perfect-city-summary/0', 'owner', p_owner::text, 'place', p_county, 'business_type', p_kind,
                            'spot', jsonb_build_object('lat', round(p_lat::numeric, 4), 'lon', round(p_lon::numeric, 4)));
end $f$"""
HELPER_REVOKE = "revoke execute on function " + HELPER_SIG + " from public"
GOOD = ("montgomery_oh", "fast_food", 39.75891, -84.19162)


class ConnectPerfectCitySummary(core.Base):
    setUp = tcr.CompilationRequests.setUp
    runner = tc.Connect.runner
    app = tc.Connect.app
    register = tc.Connect.register
    connect = tc.Connect.connect
    fails = tc.Connect.fails
    admin = tcr.CompilationRequests.admin

    def run_sql(self, sql, *args):
        """Anything that is not a SELECT (DDL, inserts): as the owner, no result expected."""
        self.db.c.execute("reset role")
        self.db.c.execute(sql, args or None)

    def make_helper(self):
        self.run_sql(HELPER)
        self.run_sql(HELPER_REVOKE)

    def switch_on(self, who):
        self.run_sql("insert into public.account_settings (owner_id, switches_on) values (%s, '{perfectCity}') on conflict (owner_id) do update set switches_on = '{perfectCity}'", who)

    def ask(self, access, county=GOOD[0], kind=GOOD[1], lat=GOOD[2], lon=GOOD[3]):
        return self.runner().one("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(access), county, kind, lat, lon)

    def test_before_the_helper_exists_the_call_says_it_is_not_available_yet_and_once_it_does_it_answers(self):
        self.switch_on(ALICE)
        _, a, _ = self.connect(ALICE)
        self.runner()
        err = self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), *GOOD, code="PT503")
        self.assertIn("Perfect City is not available yet.", str(err))
        self.make_helper()
        got = self.ask(a)
        self.assertEqual(got["schema"], "ryagram.perfect-city-summary/0")
        self.assertEqual(got["place"], "montgomery_oh")
        self.assertEqual(got["spot"], {"lat": 39.7589, "lon": -84.1916}, "the helper rounds; the twin passes the numbers on as they came")

    def test_the_helper_is_given_the_tokens_own_person_and_each_person_gets_their_own_answer(self):
        self.make_helper()
        self.switch_on(ALICE)
        self.switch_on(BOB)
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        self.assertEqual(self.ask(a)["owner"], ALICE)
        self.assertEqual(self.ask(b)["owner"], BOB)
        self.assertEqual(self.admin("select pronargs from pg_proc where oid = to_regprocedure('" + SIG + "')"), 5, "token, county, kind, latitude, longitude: no owner argument")

    def test_a_switch_that_is_off_is_refused_by_the_twin_and_an_unknown_county_reaches_the_caller_as_the_helpers_own_sentence(self):
        self.make_helper()
        _, a, _ = self.connect(ALICE)
        self.runner()
        err = self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), *GOOD, code="42501")
        self.assertIn("Perfect City is not switched on for this account.", str(err))
        self.switch_on(ALICE)
        self.runner()
        err = self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), "paris_fr", "fast_food", 39.7, -84.2, code="22023")
        self.assertIn("Choose a county: montgomery_oh or greene_oh.", str(err))

    def test_arguments_are_checked_in_plain_words_before_the_helper_runs(self):
        self.make_helper()
        _, a, _ = self.connect(ALICE)                                  # the switch is OFF: the arguments are checked before the switch, so 22023 (not 42501) proves the twin refused the arguments first
        self.runner()
        for county, kind, lat, lon in [(None, "fast_food", 39.7, -84.2), ("montgomery_oh", None, 39.7, -84.2), ("Montgomery OH", "fast_food", 39.7, -84.2),
                                       ("montgomery_oh", "fast food; drop", 39.7, -84.2), ("montgomery_oh", "fast_food", None, -84.2), ("montgomery_oh", "fast_food", 39.7, None),
                                       ("montgomery_oh", "fast_food", 90.5, -84.2), ("montgomery_oh", "fast_food", -91, -84.2), ("montgomery_oh", "fast_food", 39.7, 181), ("montgomery_oh", "fast_food", 39.7, -180.5)]:
            self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), county, kind, lat, lon, code="22023")
        self.assertIn("latitude from -90 to 90", str(self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), "montgomery_oh", "fast_food", 99, 0, code="22023")))
        self.assertIn("a place and a kind of business", str(self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), None, None, 39.7, -84.2, code="22023")))

    def test_a_token_that_is_not_valid_is_refused_and_nothing_is_written(self):
        self.make_helper()
        self.runner()
        self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", "0" * 64, *GOOD, code="PT401")
        self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", "not-a-hash", *GOOD, code="PT401")
        self.switch_on(ALICE)
        _, a, _ = self.connect(ALICE)
        count = "select (select count(*) from public.account_settings) + (select count(*) from public.projects) + (select count(*) from public.connect_tokens)"
        before = self.admin(count)
        self.ask(a)
        self.assertEqual(self.admin(count), before, "the call wrote nothing")

    def test_only_the_connector_login_can_run_it_and_not_the_helper_directly(self):
        self.make_helper()
        self.switch_on(ALICE)
        _, a, _ = self.connect(ALICE)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select public.connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), *GOOD)
        self.assertFalse(self.admin("select has_function_privilege('connect_runner', '" + HELPER_SIG + "', 'execute')"))
        self.assertFalse(self.admin("select has_function_privilege('authenticated', '" + HELPER_SIG + "', 'execute')"))

    def test_the_switch_is_checked_inside_the_twin_and_the_helper_is_never_called_without_it(self):
        """Security review 11-27, M2. The helper here is a TRAP: it always raises XX001 'HELPER WAS CALLED'. No switch, an empty settings row and a switch list without perfectCity must all be refused 42501 by the twin
        itself (so the trap never fires); with the switch, or as an app admin, the twin reaches the trap (XX001), which proves the gate lets them through. Bob has no settings row at all (fails closed)."""
        self.run_sql("create function ryagram_private.perfect_city_summary_for(p_owner uuid, p_county text, p_kind text, p_lat double precision, p_lon double precision) returns jsonb language plpgsql as $f$ begin raise exception 'HELPER WAS CALLED' using errcode = 'XX001'; end $f$")
        self.run_sql(HELPER_REVOKE)
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        self.runner()
        for label, setup in (("no settings row", None), ("empty switches", "insert into public.account_settings (owner_id, switches_on) values (%s, '{}') on conflict (owner_id) do update set switches_on = '{}'"),
                             ("other switch only", "insert into public.account_settings (owner_id, switches_on) values (%s, '{compilations}') on conflict (owner_id) do update set switches_on = '{compilations}'")):
            if setup:
                self.run_sql(setup, ALICE)
                self.runner()
            err = self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), *GOOD, code="42501")
            self.assertIn("Perfect City is not switched on for this account.", str(err), label)
        self.switch_on(ALICE)
        self.runner()
        self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(a), *GOOD, code="XX001")        # allowed: the twin reached the helper
        self.run_sql("delete from public.account_settings where owner_id = %s", ALICE)
        self.run_sql("insert into public.app_admins (user_id) values (%s) on conflict do nothing", BOB)
        self.runner()
        self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(b), *GOOD, code="XX001")        # an app admin without the switch: allowed
        self.run_sql("delete from public.app_admins where user_id = %s", BOB)
        self.runner()
        self.fails("select connect_perfect_city_summary(%s, %s, %s, %s, %s)", h(b), *GOOD, code="42501")        # no longer an admin: refused again

    def test_the_migration_adds_one_function_and_ends_with_the_gate(self):
        sql = MIG.read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])
        self.assertEqual(len([ln for ln in lines if ln.startswith("create ")]), 1)
        self.assertTrue(self.admin("select prosecdef from pg_proc where oid = to_regprocedure('" + SIG + "')"))

    def test_the_after_check_is_all_true_and_the_rollback_removes_exactly_this_function(self):
        rows = self.db.as_(None).c.execute(CHECK.read_text(encoding="utf-8")).fetchall()
        self.assertEqual(len(rows), 7)
        self.assertTrue(all(ok for _, ok in rows), rows)
        self.make_helper()
        self.assertTrue(all(ok for _, ok in self.db.as_(None).c.execute(CHECK.read_text(encoding="utf-8")).fetchall()), "with the helper present and revoked from public the check is still all true")
        before = self.admin("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private')")
        self.run_sql(RB.read_text(encoding="utf-8"))
        self.assertIsNone(self.admin("select to_regprocedure('" + SIG + "')"))
        self.assertEqual(self.admin("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private')"), before - 1)
        self.assertIsNotNone(self.admin("select to_regprocedure('" + HELPER_SIG + "')"), "the helper (GEO's) is untouched")
        self.run_sql(RB.read_text(encoding="utf-8"))                                                       # a second undo: nothing to do, no error
        self.run_sql(MIG.read_text(encoding="utf-8"))                                                      # and the migration puts it back
        self.assertTrue(all(ok for _, ok in self.db.as_(None).c.execute(CHECK.read_text(encoding="utf-8")).fetchall()))


if __name__ == "__main__":
    unittest.main()
