"""No redistribution (migrations/20261004000600): licence-restricted data is never offered for download.

Same setup as test_version_sources.py (the generated seed is loaded). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_no_redistribution.py -v

Also tests the generator's rule (tools/gen-catalog.py no_redistribution) without a database.
"""
import importlib.util
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
ROOT = Path(__file__).resolve().parents[1]
_outer_setup = core.setUpModule


def setUpModule():
    _outer_setup()
    with psycopg.connect(core._server.get_uri(database="tmpl"), autocommit=True) as c:
        c.execute((ROOT / "catalog_sources_seed.sql").read_text(encoding="utf-8"))


def story(*datasets):
    clips = [{"kind": "title", "headline": "t"}] + [{"kind": "render", "id": f"r{i}", "dataset": d, "view": "map"} for i, d in enumerate(datasets)]
    return json.dumps({"schema": 1, "engine": "sequence", "name": "t", "sequence": {"clips": clips}})


class NoRedistribution(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def restricted(self, id="nhgis_county_test"):
        self.admin("insert into catalog_sources (id, title, publisher, coverage, licence_short, runnable, no_redistribution) "
                   "values (%s, 'Restricted county data', 'IPUMS NHGIS', 'US county, 1850 to 1980', 'No redistribution', true, true) returning 1", id)
        return id

    def version(self, *datasets):
        d = self.db.as_(RYAN)
        pid = d.one("insert into projects (title) values ('P') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        d.one("update versions set story_spec = %s::jsonb where id = %s returning id", story(*datasets), vid)
        return vid

    def test_the_seed_fails_closed_today_only_clean_public_domain_data_is_downloadable(self):
        flagged = [r[0] for r in self.db.as_(None).all("select id from catalog_sources where no_redistribution order by id")]
        self.assertEqual(flagged, ["redistricting_2026"])                                                # its licence mixes public domain with CC BY-SA
        self.assertGreaterEqual(self.admin("select count(*) from catalog_sources"), 90)
        # every unflagged row's licence text is recognisably public domain / a U.S. Government work (the generator's own rule)
        bad = self.db.as_(None).all("select id, licence_full from catalog_sources where not no_redistribution "
                                    "and licence_full !~* '(public domain|government work|CC0)'")
        self.assertEqual(bad, [])
        self.assertFalse(self.db.as_(RYAN).one("select dataset_download_allowed('redistricting_2026')"))   # and the guard says no

    def test_download_is_allowed_only_for_unrestricted_catalog_data_and_fails_closed(self):
        rid = self.restricted()
        for who in (RYAN, "service"):
            d = self.db.as_(who)
            self.assertTrue(d.one("select dataset_download_allowed('state_obesity_fastfood')"), who)
            self.assertFalse(d.one("select dataset_download_allowed(%s)", rid), who)                       # flagged
            self.assertFalse(d.one("select dataset_download_allowed('not_a_dataset')"), who)               # unknown: closed
            self.assertFalse(d.one("select dataset_download_allowed(null)"), who)
            self.assertFalse(d.one("select dataset_download_allowed('u_" + "a" * 24 + "')"), who)         # an upload is not a catalog dataset
            self.assertFalse(d.one("select dataset_download_allowed('')"), who)
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select dataset_download_allowed('state_obesity_fastfood')")
        self.admin("update catalog_sources set no_redistribution = false where id = %s returning 1", rid)
        self.assertTrue(self.db.as_(RYAN).one("select dataset_download_allowed(%s)", rid))                 # the flag is the only reason

    def test_a_films_source_card_carries_the_flag_from_the_table_never_from_the_browser(self):
        rid = self.restricted()
        vid = self.version(rid, "state_obesity_fastfood")
        rows = {r[0]: r[1] for r in self.db.as_(RYAN).all("select dataset_ref, no_redistribution from sync_version_sources(%s)", vid)}
        self.assertEqual(rows, {rid: True, "state_obesity_fastfood": False})
        # the owner cannot set it: nobody writes version_sources directly
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("update version_sources set no_redistribution = false returning 1")
        # a later change to the catalog reaches the card on the next sync
        self.admin("update catalog_sources set no_redistribution = false where id = %s returning 1", rid)
        rows = {r[0]: r[1] for r in self.db.as_(RYAN).all("select dataset_ref, no_redistribution from sync_version_sources(%s)", vid)}
        self.assertEqual(rows[rid], False)

    def test_an_upload_source_is_unaffected(self):
        vid = self.version("state_obesity_fastfood")
        self.db.as_(RYAN).all("select * from sync_version_sources(%s)", vid)
        self.admin("insert into version_sources (owner_id, version_id, kind, dataset_ref, title, position) values (%s, %s, 'upload', 'u_abc', 'Mine', 2) returning 1", RYAN, vid)
        self.assertEqual(self.db.as_(RYAN).one("select no_redistribution from version_sources where dataset_ref = 'u_abc'"), False)


class GeneratorRule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("gen_catalog", ROOT.parent / "tools" / "gen-catalog.py")
        cls.gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.gen)

    def test_the_rule_fails_closed(self):
        f = self.gen.no_redistribution
        # restricted
        self.assertTrue(f({"id": "nhgis_county_population", "license": "U.S. Government work, public domain"}))          # by id pattern, whatever it says
        self.assertTrue(f({"id": "ipums_usa_x"}))
        self.assertTrue(f({"id": "x", "license": "Terms: the data may not be redistributed."}))
        self.assertTrue(f({"id": "x", "license": "Private. Not published, not redistributable."}))
        self.assertTrue(f({"id": "x", "license": "Redistribution is prohibited without permission."}))
        self.assertTrue(f({"id": "x", "license": "U.S. Government work, public domain.", "notes": "No redistribution."}))   # a note can only tighten
        self.assertTrue(f({"id": "x", "license": "All rights reserved."}))
        # unknown, missing or merely different = restricted (the point of this change)
        self.assertTrue(f({"id": "x"}))
        self.assertTrue(f({"id": "x", "license": ""}))
        self.assertTrue(f({"id": "x", "license": None}))
        self.assertTrue(f({"id": "x", "license": "Not stated by the publisher."}))
        self.assertTrue(f({"id": "x", "license": "See the publisher"}))
        self.assertTrue(f({"id": "x", "license": "Open data; you may redistribute with attribution."}))                # not a RECOGNISED licence
        self.assertTrue(f({"id": "x", "license": "Creative Commons Attribution 4.0"}))
        self.assertTrue(f({"id": "x", "license": "Census TIGERweb: U.S. Government work, public domain. Seat figures: Wikipedia, CC BY-SA 4.0."}))   # mixed: strictest wins
        self.assertTrue(f({"id": "x", "license": "Public domain for the shapes; licensed under a proprietary agreement for the figures."}))
        # recognised as redistributable
        self.assertFalse(f({"id": "cbp_x", "license": "U.S. Government work, public domain. The Census Bureau asks that the source be cited."}))
        self.assertFalse(f({"id": "x", "license": "Public domain"}))
        self.assertFalse(f({"id": "x", "license": "CC0 1.0"}))
        self.assertFalse(f({"id": "x", "license": "U.S. Government work in the public domain (17 USC 105)"}))
        # the explicit allow-list is the only other way in, and it can never override wording that forbids redistribution
        self.gen.REDISTRIBUTABLE_IDS = frozenset({"listed", "listed_but_forbidden"})
        try:
            self.assertFalse(f({"id": "listed", "license": "Some custom open licence"}))
            self.assertTrue(f({"id": "listed_but_forbidden", "license": "May not be redistributed."}))
            self.assertTrue(f({"id": "unlisted", "license": "Some custom open licence"}))
        finally:
            self.gen.REDISTRIBUTABLE_IDS = frozenset()

    def test_every_dataset_the_engine_lists_gets_an_answer_even_with_no_licence_field(self):
        self.assertIs(self.gen.no_redistribution({"id": "a_new_dataset_with_no_fields_at_all"}), True)

    def test_the_seed_has_the_column_for_every_row(self):
        seed = (ROOT / "catalog_sources_seed.sql").read_text(encoding="utf-8")
        self.assertIn("no_redistribution) values", seed)
        self.assertIn("no_redistribution = excluded.no_redistribution", seed)


if __name__ == "__main__":
    unittest.main()
