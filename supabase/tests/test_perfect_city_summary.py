"""PERFECT CITY, THE AI TOOL'S SUMMARY (ryagram_private.perfect_city_summary_for in migrations/20261127000900_perfect_city_places.sql) on a local Postgres.

GEO 2026-11-27. CONNECT wraps this helper with its token check (proposals/CONNECT-DEPT-PERFECT-CITY-1127.md part B, schema ryagram.perfect-city-summary/0).
Run: pgvenv/Scripts/python -m unittest supabase/tests/test_perfect_city_summary.py -v

What this proves: the same gate as the page (switch perfectCity or an app admin; else 42501); unknown county or kind, grocery in Greene, a spot outside
the county or no county data: 22023; the nearest places (straight-line km, basis calculated), the counts within 1, 2 and 5 km (calculated) and the
people within each ring (estimated, block-group centre method) are right on invented points; and, with the REAL Census seed file
(supabase/live-steps/perfect_city_units_seed.sql, public domain), the people within each ring EQUAL what the page computes in the browser for the same
spot (assets/perfect-city-core.js peopleWithin, values pinned below from node). No OpenStreetMap data is used: every place is invented.
"""
import math
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
setUpModule = core.setUpModule
ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "live-steps" / "perfect_city_units_seed.sql"
CALL = "select ryagram_private.perfect_city_summary_for(%s, %s, %s, %s, %s)"

# The page's own numbers (node, assets/perfect-city-core.js peopleWithin on assets/perfect-city/montgomery_oh.census.js), 11-27:
PAGE_PEOPLE = {(-84.1916, 39.7589): [4200, 13300, 100700], (-84.2374, 39.7509): [2200, 11500, 66300]}


def km(lat1, lon1, lat2, lon2):
    r = math.radians
    s = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1, math.sqrt(s)))


class PerfectCitySummary(core.Base):
    def setUp(self):
        super().setUp()
        self.owner(SEED.read_text(encoding="utf-8"))           # the real Census seed: 546 block groups (public domain)
        # invented places due north of a spot near Dayton: 0.5, 1.5, 1.9, 3, 4.99 and 7 km
        self.spot = (39.7589, -84.1916)
        for i, d in enumerate([0.5, 1.5, 1.9, 3, 4.99, 7]):
            self.owner("insert into ryagram_private.perfect_city_places (county, kind, osm_ref, name, lat, lon) values ('montgomery_oh', 'fast_food', %s, %s, %s, %s)",
                       f"n{900 + i}", f"Test Place {i}", self.spot[0] + d / 111.195, self.spot[1])

    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def switch_on(self, who):
        self.owner("insert into public.account_settings (owner_id, switches_on) values (%s, '{perfectCity}') on conflict (owner_id) do update set switches_on = excluded.switches_on", who)

    def summary(self, who, county="montgomery_oh", kind="fast_food", lat=None, lon=None):
        lat = self.spot[0] if lat is None else lat
        lon = self.spot[1] if lon is None else lon
        return self.db.as_(None).one(CALL, who, county, kind, lat, lon)

    def refused(self, code, *args):
        with self.assertRaises(psycopg.Error, msg=args) as cm:
            self.db.as_(None).c.execute(CALL, args)
        self.assertEqual(cm.exception.sqlstate, code, (args, cm.exception))

    def test_01_the_seed_is_the_census_totals(self):
        n, pop = self.db.as_(None).c.execute("select count(*), sum(pop) from ryagram_private.perfect_city_units").fetchone()
        self.assertEqual((n, pop), (546, 537309 + 167966))

    def test_02_gate(self):
        self.refused("42501", OTHER, "montgomery_oh", "fast_food", *self.spot)            # no switch
        self.refused("42501", None, "montgomery_oh", "fast_food", *self.spot)             # no owner
        self.switch_on(OTHER)
        self.assertEqual(self.summary(OTHER)["schema"], "ryagram.perfect-city-summary/0")
        self.owner("insert into public.app_admins (user_id, note) values (%s, 'test')", RYAN)
        self.assertEqual(self.summary(RYAN)["place"], "montgomery_oh")                     # an admin without the switch
        third = "00000000-0000-4000-8000-000000000333"
        self.refused("42501", third, "montgomery_oh", "fast_food", *self.spot)            # anyone else: no
        self.owner("update public.departments set status = 'working' where id = 'geo_intelligence'")
        self.assertEqual(self.summary(third)["place"], "montgomery_oh")                    # the public flip opens it for everyone

    def test_03_refusals_in_words(self):
        self.switch_on(OTHER)
        for args in [("ohio", "fast_food", *self.spot), ("montgomery_oh", "bars", *self.spot), ("greene_oh", "grocery", 39.70, -83.98),
                     ("montgomery_oh", "fast_food", 40.5, -84.19), ("montgomery_oh", "fast_food", None, -84.19)]:
            self.refused("22023", OTHER, *args)

    def test_04_numbers_on_invented_points(self):
        self.switch_on(OTHER)
        s = self.summary(OTHER)
        self.assertEqual(s["places_loaded"], {"count": 6, "basis": "calculated"})
        self.assertEqual(s["spot"], {"lat": 39.7589, "lon": -84.1916, "is_default": False})
        self.assertEqual([p["rank"] for p in s["nearest"]], [1, 2, 3, 4, 5])
        self.assertTrue(all(set(p) == {"rank", "km", "basis"} for p in s["nearest"]), "no business names reach a person's AI (G11)")
        self.assertNotIn("Test Place", str(s))
        self.assertAlmostEqual(s["nearest"][0]["km"], 0.5, places=2)
        self.assertTrue(all(p["basis"] == "calculated" for p in s["nearest"]))
        self.assertEqual([(r["km"], r["places"]["count"], r["places"]["basis"]) for r in s["rings"]], [(1, 1, "calculated"), (2, 3, "calculated"), (5, 5, "calculated")])
        for r in s["rings"]:
            self.assertEqual(r["people_about"]["basis"], "estimated")
            self.assertIn("centre is inside the ring", r["people_about"]["method"])
        self.assertTrue(any("straight lines" in t for t in s["not_known"]) and any("no success score" in t for t in s["not_known"]))
        self.assertIn("Map data (c) OpenStreetMap contributors (ODbL)", s["credits"])
        self.assertNotIn("osm_ref", str(s))

    def test_05_people_match_the_page_exactly(self):
        self.switch_on(OTHER)
        for (lon, lat), expected in PAGE_PEOPLE.items():
            s = self.summary(OTHER, lat=lat, lon=lon)
            self.assertEqual([r["people_about"]["value"] for r in s["rings"]], expected, (lat, lon))

    def test_06_distance_formula_matches_python(self):
        got = self.db.as_(None).one("select ryagram_private.perfect_city_km(39.7589, -84.1916, 39.6848, -83.9297)")
        self.assertAlmostEqual(got, km(39.7589, -84.1916, 39.6848, -83.9297), places=9)

    def test_07_closed_to_api_roles(self):
        for role in ("anon", "authenticated"):
            for fn in ("ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)",
                       "ryagram_private.perfect_city_km(double precision, double precision, double precision, double precision)"):
                self.assertFalse(self.db.as_(None).one("select has_function_privilege(%s, %s, 'execute')", role, fn), (role, fn))
            self.assertFalse(self.db.as_(None).one("select has_table_privilege(%s, 'ryagram_private.perfect_city_units', 'select')", role), role)


if __name__ == "__main__":
    unittest.main()
