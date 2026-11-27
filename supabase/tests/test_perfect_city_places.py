"""PERFECT CITY PLACES, DATABASE HALF (migrations/20261127000900_perfect_city_places.sql) on a local Postgres.

GEO 2026-11-27. Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_perfect_city_places.py -v

What this proves: a signed-in account WITHOUT the perfectCity switch is refused (42501), and so are a visitor and a caller with no account; WITH the switch, or as an app admin, the caller gets
the places of exactly one county and one kind, sorted by name then osm_ref, with the OpenStreetMap credit and never the osm_ref; at most 60 places, but 'within' counts every place within 1, 2 and 5 km, before the cap (80 in a
dense cluster, not 60); a county or kind outside the lists is refused (22023);
the table is closed to every API role; the function is security definer with an empty search_path (and the check of that catches a planted mutant); the migration ends with the gate and
the gate guarded the function; the rollback removes exactly the two new objects (every other function and table is as it was before the migration).
Every place here is INVENTED (Test Place n, near 39.75,-84.2): no map data is in the repo.
"""
import math
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
setUpModule = core.setUpModule
ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "migrations" / "20261127000900_perfect_city_places.sql"
ROLLBACK = ROOT / "rollbacks" / "20261127000900_perfect_city_places_rollback.sql"
SEED = ROOT / "live-steps" / "perfect_city_units_seed.sql"
SIG = "public.perfect_city_places(text, text, double precision, double precision)"
CALL = "select public.perfect_city_places(%s, %s, %s, %s)"
SPOT = {"montgomery_oh": (39.7505, -84.2000), "greene_oh": (39.7000, -84.0500)}      # a spot inside each county, near the invented places
CREDIT = "Map data (c) OpenStreetMap contributors (ODbL)"

# invented points only
POINTS = [
    ("montgomery_oh", "fast_food", "n103", "Test Place 3", 39.7531, -84.1912),
    ("montgomery_oh", "fast_food", "n101", "Test Place 1", 39.7502, -84.2004),
    ("montgomery_oh", "fast_food", "w102", "Test Place 2", 39.7518, -84.1987),
    ("montgomery_oh", "fast_food", "n100", "Test Place 2", 39.7499, -84.2011),       # same name: osm_ref decides the order
    ("montgomery_oh", "grocery", "n201", "Test Place 9", 39.7444, -84.2101),
    ("greene_oh", "fast_food", "n301", "Test Place 0", 39.7008, -84.0505),
]

# the catalog snapshot used by the rollback check: every function (signature, body, settings, grants) and every table (grants) outside the system schemas
SNAPSHOT_FUNCS = ("select n.nspname || '.' || p.oid::regprocedure::text, md5(p.prosrc), coalesce(p.proconfig::text, ''), p.prosecdef, coalesce(p.proacl::text, '') "
                  "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%%' order by 1")
SNAPSHOT_TABLES = ("select n.nspname || '.' || c.relname, c.relkind::text, coalesce(c.relacl::text, '') from pg_class c join pg_namespace n on n.oid = c.relnamespace "
                   "where c.relkind in ('r', 'p', 'v', 'm') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%%' order by 1")


def km(lat1, lon1, lat2, lon2):
    """The haversine distance in km, the same formula as ryagram_private.perfect_city_km and assets/perfect-city-core.js km()."""
    r = math.radians
    s = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(s)))


def definer_ok(c, sig):
    """True only if the function is SECURITY DEFINER with search_path set to empty and nothing else."""
    row = c.execute("select p.prosecdef, p.proconfig from pg_proc p where p.oid = %s::regprocedure", (sig,)).fetchone()
    return bool(row) and row[0] is True and row[1] == ['search_path=""']


class PerfectCityPlaces(core.Base):
    def setUp(self):
        super().setUp()
        self.owner(SEED.read_text(encoding="utf-8"))           # the real Census block groups (public domain): the spot check needs the county box
        for r in POINTS:
            self.owner("insert into ryagram_private.perfect_city_places (county, kind, osm_ref, name, lat, lon) values (%s, %s, %s, %s, %s, %s)", *r)

    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def switch_on(self, who, switches="{perfectCity}"):
        self.owner("insert into public.account_settings (owner_id, switches_on) values (%s, %s) on conflict (owner_id) do update set switches_on = excluded.switches_on", who, switches)

    def make_admin(self, who):
        self.owner("insert into public.app_admins (user_id, note) values (%s, 'test')", who)

    def get(self, who, county="montgomery_oh", kind="fast_food"):
        try:
            return self.db.as_(who).one(CALL, county, kind, *SPOT.get(county, SPOT["montgomery_oh"]))
        except psycopg.Error as e:
            self.fail(f"a call that was meant to work was refused: {e.sqlstate} {e.diag.message_primary}")        # a failed check, not a crash

    def refused(self, who, *args, code):
        if len(args) == 2:
            args = (*args, *SPOT.get(args[0], SPOT["montgomery_oh"]))
        with self.assertRaises(psycopg.Error, msg=(who, args)) as cm:
            self.db.as_(who).c.execute(CALL, args)
        self.assertEqual(cm.exception.sqlstate, code, (who, args, cm.exception))
        return cm.exception

    # ---------------------------------------------------------------------------------------------- (a) no switch, no entry
    def test_a_signed_in_account_without_the_switch_is_refused_in_words(self):
        e = self.refused(OTHER, "montgomery_oh", "fast_food", code="42501")
        self.assertIn("Perfect City", e.diag.message_primary)
        self.switch_on(OTHER, "{aiFirst,liveEditor}")                                       # other switches on: still no
        self.refused(OTHER, "montgomery_oh", "fast_food", code="42501")
        self.switch_on(OTHER, "{perfectCityX}")                                             # a longer name is not the switch
        self.refused(OTHER, "montgomery_oh", "fast_food", code="42501")
        self.switch_on(RYAN)                                                                # another account's switch does not count
        self.refused(OTHER, "montgomery_oh", "fast_food", code="42501")

    def test_a_caller_with_no_account_and_the_worker_account_are_refused(self):
        d = self.db.as_(OTHER)
        d.c.execute("select set_config('request.jwt.claim.sub', '', false)")
        with self.assertRaises(psycopg.Error) as cm:
            d.c.execute(CALL, ("montgomery_oh", "fast_food", *SPOT["montgomery_oh"]))
        self.assertEqual(cm.exception.sqlstate, "42501")
        self.switch_on(WORKER)
        self.refused(WORKER, "montgomery_oh", "fast_food", code="42501")

    # ---------------------------------------------------------------------------------------------- (b) with the switch
    def test_with_the_switch_the_caller_gets_one_county_and_kind_sorted_with_the_credit_and_no_osm_ref(self):
        self.switch_on(OTHER)
        got = self.get(OTHER)
        self.assertEqual(set(got), {"county", "kind", "radius_km", "max_places", "credit", "loaded", "within", "places"})
        self.assertEqual((got["radius_km"], got["loaded"]), (5, 4))
        self.assertEqual(got["within"], {"1": 4, "2": 4, "5": 4})                                 # all four within 0.81 km
        self.assertEqual((got["county"], got["kind"], got["credit"]), ("montgomery_oh", "fast_food", CREDIT))
        self.assertEqual(got["places"], [
            {"name": "Test Place 1", "lat": 39.7502, "lon": -84.2004},
            {"name": "Test Place 2", "lat": 39.7499, "lon": -84.2011},                      # nearest first (0.11 km, then 0.18 km)
            {"name": "Test Place 2", "lat": 39.7518, "lon": -84.1987},
            {"name": "Test Place 3", "lat": 39.7531, "lon": -84.1912}])
        for p in got["places"]:
            self.assertEqual(set(p), {"name", "lat", "lon"}, "never the osm_ref")
        grocery = self.get(OTHER, kind="grocery")
        self.assertEqual([p["name"] for p in grocery["places"]], ["Test Place 9"])
        self.assertEqual(grocery["within"], {"1": 0, "2": 1, "5": 1})                              # 1.10 km away: one county and one kind only
        self.assertEqual([p["name"] for p in self.get(OTHER, county="greene_oh")["places"]], ["Test Place 0"])
        empty = self.get(OTHER, county="greene_oh", kind="restaurant")
        self.assertEqual((empty["places"], empty["credit"], empty["loaded"], empty["within"]), ([], CREDIT, 0, {"1": 0, "2": 0, "5": 0}))
        self.assertNotIn("n10", str(got), "no osm_ref anywhere in the answer")

    def test_never_more_than_60_places_in_one_answer_but_within_counts_every_place(self):
        self.switch_on(OTHER)
        lat0, lon0 = SPOT["montgomery_oh"]
        dense = [(f"r{i}", f"Test Place R{i}", lat0 + (i % 9) * 0.0015, lon0 + (i // 9) * 0.0015) for i in range(80)]     # 80 invented places, all within 1.7 km
        far = [("f1", "Test Place F1", lat0 + 0.027, lon0), ("f2", "Test Place F2", lat0 - 0.027, lon0),                 # about 3 km: inside 5 km only
               ("f3", "Test Place F3", lat0 + 0.09, lon0)]                                                                 # about 10 km: outside every ring
        for r in dense + far:
            self.owner("insert into ryagram_private.perfect_city_places (county, kind, osm_ref, name, lat, lon) values ('montgomery_oh', 'restaurant', %s, %s, %s, %s)", *r)
        self.assertTrue(all(km(lat0, lon0, la, lo) <= 2 for _, _, la, lo in dense), "the dense cluster is inside 2 km")
        got = self.get(OTHER, kind="restaurant")
        self.assertEqual((got["loaded"], len(got["places"]), got["max_places"]), (83, 60, 60))
        # the TRUE counts, counted before the cap (RENDERER 09:12): 80 within 2 km, not the 60 the answer carries
        within_1 = sum(1 for _, _, la, lo in dense + far if km(lat0, lon0, la, lo) <= 1)
        self.assertGreater(within_1, 0)
        self.assertEqual(got["within"], {"1": within_1, "2": 80, "5": 82})

    def test_a_daily_count_refuses_in_words_past_the_cap_and_a_refused_call_counts(self):
        self.switch_on(OTHER)
        self.owner("insert into ryagram_private.perfect_city_calls (owner_id, day, calls) values (%s, (now() at time zone 'utc')::date, 299)", OTHER)
        self.get(OTHER)                                                                    # call 300: allowed
        e = self.refused(OTHER, "montgomery_oh", "fast_food", code="54000")                  # call 301: refused in words
        self.assertIn("Try again tomorrow", e.diag.message_primary)
        self.owner("update public.departments set status = 'working' where id = 'geo_intelligence'")
        self.owner("insert into ryagram_private.perfect_city_calls (owner_id, day, calls) values (%s, (now() at time zone 'utc')::date, 40)", RYAN)
        self.refused(RYAN, "montgomery_oh", "fast_food", code="54000")                        # let in by the public flip only: 40 a day
        for role in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.owner("select has_table_privilege(%s, 'ryagram_private.perfect_city_calls', 'select,insert,update,delete')", role).fetchone()[0], role)

    def test_the_public_flip_opens_it_for_every_signed_in_account(self):
        self.refused(OTHER, "montgomery_oh", "fast_food", code="42501")
        self.owner("update public.departments set status = 'working' where id = 'geo_intelligence'")
        self.assertEqual(self.get(OTHER)["loaded"], 4)
        self.refused("anon", "montgomery_oh", "fast_food", code="42501")                     # a visitor still cannot

    # ---------------------------------------------------------------------------------------------- (c) an admin
    def test_an_app_admin_without_the_switch_is_allowed(self):
        self.make_admin(RYAN)
        self.assertEqual(len(self.get(RYAN)["places"]), 4)
        self.refused(OTHER, "montgomery_oh", "fast_food", code="42501")                    # and nobody else is

    # ---------------------------------------------------------------------------------------------- (d) who may execute
    def test_a_visitor_cannot_execute_and_only_authenticated_holds_the_grant(self):
        self.switch_on(OTHER)
        self.refused("anon", "montgomery_oh", "fast_food", code="42501")
        for role, allowed in (("anon", False), ("authenticated", True), ("service_role", False), ("public", False)):
            got = self.owner("select has_function_privilege(%s, %s, 'execute')", role, SIG).fetchone()[0]
            self.assertEqual(got, allowed, role)

    def test_the_table_is_closed_to_every_api_role(self):
        self.switch_on(OTHER)
        for role in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.owner("select has_table_privilege(%s, 'ryagram_private.perfect_city_places', 'select,insert,update,delete')", role).fetchone()[0], role)
        for who in (OTHER, "anon", "service"):
            with self.assertRaises(psycopg.Error, msg=who) as cm:
                self.db.as_(who).c.execute("select * from ryagram_private.perfect_city_places")
            self.assertEqual(cm.exception.sqlstate, "42501", who)

    # ---------------------------------------------------------------------------------------------- (e) bad county or kind
    def test_a_bad_county_or_kind_is_refused_in_words(self):
        self.switch_on(OTHER)
        for county in (None, "", "Montgomery_OH", "montgomery_oh ", "clark_oh", "montgomery_oh'; --"):
            e = self.refused(OTHER, county, "fast_food", code="22023")
            self.assertIn("county", e.diag.message_primary)
        for kind in (None, "", "Fast_Food", "cafe", "grocery,restaurant"):
            e = self.refused(OTHER, "montgomery_oh", kind, code="22023")
            self.assertIn("kind", e.diag.message_primary)
        self.make_admin(RYAN)
        self.refused(RYAN, "clark_oh", "fast_food", code="22023")

    def test_the_table_itself_refuses_a_bad_row(self):
        for bad in (("clark_oh", "grocery", "x1", "Test Place", 39.7, -84.2), ("greene_oh", "cafe", "x2", "Test Place", 39.7, -84.2),
                    ("greene_oh", "grocery", "x3", "Test Place", 91.0, -84.2), ("greene_oh", "grocery", "x4", "Test Place", 39.7, -181.0)):
            with self.assertRaises(psycopg.Error, msg=bad) as cm:
                self.owner("insert into ryagram_private.perfect_city_places (county, kind, osm_ref, name, lat, lon) values (%s, %s, %s, %s, %s, %s)", *bad)
            self.assertEqual(cm.exception.sqlstate, "23514", bad)

    # ---------------------------------------------------------------------------------------------- (g) security definer, empty search_path, and the gate
    def test_the_function_is_security_definer_with_an_empty_search_path_and_the_check_catches_a_mutant(self):
        c = self.db.as_(None).c
        self.assertTrue(definer_ok(c, SIG))
        c.execute("alter function public.perfect_city_places(text, text, double precision, double precision) security invoker")          # MUST-FAIL: a planted fault in this test's own throwaway database
        self.assertFalse(definer_ok(c, SIG), "the check missed a function that is not security definer")
        c.execute("alter function public.perfect_city_places(text, text, double precision, double precision) security definer")
        c.execute("alter function public.perfect_city_places(text, text, double precision, double precision) set search_path = public")
        self.assertFalse(definer_ok(c, SIG), "the check missed a non-empty search_path")
        c.execute("alter function public.perfect_city_places(text, text, double precision, double precision) reset search_path")
        self.assertFalse(definer_ok(c, SIG), "the check missed a missing search_path")
        c.execute("alter function public.perfect_city_places(text, text, double precision, double precision) set search_path = ''")
        self.assertTrue(definer_ok(c, SIG))

    def test_the_migration_ends_with_the_gate_and_the_gate_guarded_the_function(self):
        lines = [ln.strip() for ln in MIG.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertTrue(lines[-2].startswith("select ryagram_private.gate_apply();"), lines[-2:])
        self.assertEqual(lines[-1], "commit;")
        src = self.owner("select prosrc from pg_proc where oid = %s::regprocedure", SIG).fetchone()[0]
        self.assertIn("perform ryagram_private.require_active();", src)
        self.assertNotRegex(MIG.read_text(encoding="utf-8").lower(), r"raise\s+(notice|log|warning|info|debug)")

    # ---------------------------------------------------------------------------------------------- (f) the rollback
    def test_never_a_whole_county_only_the_places_within_5_km_and_the_nearest_five(self):
        self.switch_on(OTHER)
        for i in range(12):                                                                # invented places 10 to 21 km north of the spot
            self.owner("insert into ryagram_private.perfect_city_places (county, kind, osm_ref, name, lat, lon) values ('montgomery_oh', 'fast_food', %s, %s, %s, %s)",
                       f"far{i}", f"Far Test Place {i}", 39.7505 + (10 + i) / 111.195, -84.2000)
        got = self.get(OTHER)
        self.assertEqual(got["loaded"], 16)
        self.assertEqual([p["name"] for p in got["places"]], ["Test Place 1", "Test Place 2", "Test Place 2", "Test Place 3", "Far Test Place 0"])   # 4 within 5 km + the 5th nearest
        e = self.refused(OTHER, "montgomery_oh", "fast_food", 40.6, -84.2, code="22023")           # a spot outside the county
        self.assertIn("outside the county", e.diag.message_primary)
        self.refused(OTHER, "greene_oh", "grocery", code="22023")                                # no supermarket data in Greene

    def test_the_rollback_removes_exactly_the_new_objects_and_nothing_else(self):
        name = "pcrb" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        try:
            with psycopg.connect(core._server.get_uri(database=name), autocommit=True) as c:
                c.execute("".join(l for l in (ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True) if not l.startswith("create role")))   # roles are cluster-wide
                for path in core.MIGRATIONS:
                    if path.name != MIG.name:
                        c.execute(path.read_text(encoding="utf-8"))
                before = (c.execute(SNAPSHOT_FUNCS).fetchall(), c.execute(SNAPSHOT_TABLES).fetchall())
                c.execute(MIG.read_text(encoding="utf-8"))
                self.assertIsNotNone(c.execute("select to_regprocedure(%s)", (SIG,)).fetchone()[0])
                self.assertIsNotNone(c.execute("select to_regclass('ryagram_private.perfect_city_places')").fetchone()[0])
                c.execute(ROLLBACK.read_text(encoding="utf-8"))
                self.assertIsNone(c.execute("select to_regprocedure(%s)", (SIG,)).fetchone()[0])
                self.assertIsNone(c.execute("select to_regclass('ryagram_private.perfect_city_places')").fetchone()[0])
                self.assertIsNone(c.execute("select to_regclass('ryagram_private.perfect_city_units')").fetchone()[0])
                self.assertIsNone(c.execute("select to_regclass('ryagram_private.perfect_city_calls')").fetchone()[0])
                for fn in ("ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)", "ryagram_private.perfect_city_check(uuid, text, text, double precision, double precision)",
                           "ryagram_private.perfect_city_km(double precision, double precision, double precision, double precision)"):
                    self.assertIsNone(c.execute("select to_regprocedure(%s)", (fn,)).fetchone()[0], fn)
                after = (c.execute(SNAPSHOT_FUNCS).fetchall(), c.execute(SNAPSHOT_TABLES).fetchall())
                self.assertTrue(before[0] and before[1])
                self.assertEqual(after[0], before[0], "functions differ after migration + rollback")
                self.assertEqual(after[1], before[1], "tables differ after migration + rollback")
                c.execute(ROLLBACK.read_text(encoding="utf-8"))                                            # safe twice
        finally:
            with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
                c.execute(f"drop database {name}")


if __name__ == "__main__":
    unittest.main()
