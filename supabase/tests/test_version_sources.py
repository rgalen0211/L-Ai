"""The sources screen (migrations/20261004000100_version_sources.sql + the generated seed) on a local Postgres.

Same setup as test_2a_core.py (the file is one of the migrations it loads); the seed is loaded here.
Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_version_sources.py -v
"""
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
    # The generated seed goes into the template database the tests copy.
    with psycopg.connect(core._server.get_uri(database="tmpl"), autocommit=True) as c:
        c.execute((ROOT / "catalog_sources_seed.sql").read_text(encoding="utf-8"))


def story(*datasets):
    clips = [{"kind": "title", "headline": "t"}] + [{"kind": "render", "id": f"r{i}", "dataset": d, "view": "map"}
                                                      for i, d in enumerate(datasets)]
    return json.dumps({"schema": 1, "engine": "sequence", "name": "t", "sequence": {"clips": clips}})


class Sources(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def version(self, *datasets, who=RYAN):
        d = self.db.as_(who)
        pid = d.one("insert into projects (title) values ('Sources') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        d.one("update versions set story_spec = %s::jsonb where id = %s returning id", story(*datasets), vid)
        return vid

    def sync(self, vid, who=RYAN):
        return self.db.as_(who).all("select dataset_ref, kind, title, publisher, coverage, licence_short, position "
                                    "from sync_version_sources(%s)", vid)

    def test_the_seed_is_the_catalog_and_marks_what_can_run(self):
        self.assertGreaterEqual(self.admin("select count(*) from catalog_sources"), 90)
        self.assertGreaterEqual(self.admin("select count(*) from catalog_sources where runnable"), 20)
        row = self.admin("select publisher, coverage, licence_short, runnable, source_url from catalog_sources "
                         "where id = 'cbp_manufacturing_share_state'")
        self.assertEqual(row[0], "U.S. Census Bureau, County Business Patterns")
        self.assertIn("1998 to 2023", row[1])
        self.assertEqual(row[2], "U.S. Government work, public domain")
        self.assertTrue(row[3])
        self.assertTrue(row[4].startswith("https://"))
        # Fixtures and private data are not in it; a dataset the worker can't run yet is marked not runnable.
        self.assertEqual(self.admin("select count(*) from catalog_sources where id ~ '^(example_corp|ryan_)'"), 0)
        self.assertFalse(self.admin("select runnable from catalog_sources where id = 'cbp_retail_employment'"))

    def test_a_story_makes_its_sources_with_facts_from_the_database(self):
        vid = self.version("state_obesity_fastfood")
        rows = self.sync(vid)
        self.assertEqual(len(rows), 1)
        ref, kind, title, publisher, coverage, licence, pos = rows[0]
        self.assertEqual((ref, kind, pos), ("state_obesity_fastfood", "catalog", 1))
        self.assertIn("CDC", publisher)
        self.assertTrue(coverage and licence)
        # Owners read their own rows; nobody else sees them; nobody writes directly; the catalog is unreadable.
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from version_sources"), 1)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from version_sources"), 0)
        for sql in ("insert into version_sources (owner_id, version_id, kind, dataset_ref, title) values (%s, %s, 'catalog', 'x', 'x')",
                    "update version_sources set title = 'x'", "delete from version_sources"):
            with self.subTest(sql=sql), self.assertRaises(psycopg.Error):
                self.db.as_(RYAN).one(sql + " returning 1", *((RYAN, vid) if "insert" in sql else ()))
        for who in (RYAN, OTHER, "anon", "service"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select * from catalog_sources")

    def test_sync_follows_the_story_in_order_and_removes_what_it_no_longer_names(self):
        vid = self.version("bps_county_permits", "state_obesity_fastfood", "bps_county_permits")
        self.assertEqual([r[0] for r in self.sync(vid)], ["bps_county_permits", "state_obesity_fastfood"])   # once each
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning 1", story("state_obesity_fastfood"), vid)
        self.assertEqual([(r[0], r[6]) for r in self.sync(vid)], [("state_obesity_fastfood", 1)])
        self.assertEqual(self.sync(vid), self.sync(vid))                                                    # idempotent
        # A story with no render clips has no sources; a blank or odd story is not an error.
        for spec in ('{}', '{"sequence": {"clips": "no"}}', '{"sequence": {"clips": [{"kind": "title"}]}}'):
            self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning 1", spec, vid)
            self.assertEqual(self.sync(vid), [])

    def test_up_to_five_sources_known_and_runnable_only(self):
        five = ["state_obesity_fastfood", "bps_county_permits", "bls_state_unemployment", "cbp_suppression", "cbp_county_grocery"]
        vid = self.version(*five)
        self.assertEqual(len(self.sync(vid)), 5)
        six = self.version(*five, "cbp_manufacturing_share_state")
        with self.assertRaisesRegex(psycopg.Error, "up to 5 sources"):
            self.sync(six)
        self.assertEqual(self.admin("select count(*) from version_sources where version_id = %s", six), 0)
        unknown = self.version("not_a_dataset")
        with self.assertRaisesRegex(psycopg.Error, "don't have data called"):
            self.sync(unknown)
        later = self.version("cbp_retail_employment")
        with self.assertRaisesRegex(psycopg.Error, "can't run it yet"):
            self.sync(later)
        injected = self.version("x'); drop table version_sources; --")
        with self.assertRaises(psycopg.Error):
            self.sync(injected)
        self.assertEqual(self.admin("select count(*) from version_sources where version_id = %s", injected), 0)

    def test_only_the_owner_and_locked_versions_stay_as_they_were(self):
        vid = self.version("state_obesity_fastfood")
        with self.assertRaisesRegex(psycopg.Error, "Version not found"):
            self.sync(vid, who=OTHER)
        with self.assertRaises(psycopg.Error):
            self.sync(vid, who="anon")
        self.sync(vid)
        # Once the version is locked (here: archived), the story is no longer the live truth and sync only reads.
        self.admin("update versions set state = 'archived' where id = %s returning 1", vid)
        self.admin("update versions set story_spec = %s::jsonb where id = %s returning 1", story("bps_county_permits"), vid)
        self.assertEqual([r[0] for r in self.sync(vid)], ["state_obesity_fastfood"])

    def test_an_upload_source_survives_a_sync_and_deleting_the_account_removes_all(self):
        vid = self.version("state_obesity_fastfood")
        self.sync(vid)
        self.admin("insert into version_sources (owner_id, version_id, kind, dataset_ref, title, position) "
                   "values (%s, %s, 'upload', 'u_abc', 'My file', 2) returning 1", RYAN, vid)
        self.assertEqual([r[1] for r in self.sync(vid)], ["catalog", "upload"])
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning 1", story("bps_county_permits"), vid)
        self.assertEqual(sorted(r[0] for r in self.sync(vid)), ["bps_county_permits", "u_abc"])
        self.admin("delete from auth.users where id = %s returning 1", RYAN)
        self.assertEqual(self.admin("select count(*) from version_sources"), 0)

    def test_the_seed_can_be_rerun(self):
        self.admin("update catalog_sources set coverage = 'stale', runnable = false returning 1")
        with psycopg.connect(core._server.get_uri(database=self.db.c.info.dbname), autocommit=True) as c:
            c.execute((ROOT / "catalog_sources_seed.sql").read_text(encoding="utf-8"))
        self.assertEqual(self.admin("select count(*) from catalog_sources where coverage = 'stale'"), 0)
        self.assertTrue(self.admin("select runnable from catalog_sources where id = 'state_obesity_fastfood'"))


if __name__ == "__main__":
    unittest.main()
