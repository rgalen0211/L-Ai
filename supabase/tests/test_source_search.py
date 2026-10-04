"""Source search (migrations/20261004000400_source_search.sql): caps, usage pricing, the data-gap queue, admin counts.

Same setup as test_2a_core.py; the generated catalog seed is loaded because the function reads catalog_sources.
Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_source_search.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
ROOT = Path(__file__).resolve().parents[1]
_outer_setup = core.setUpModule


def setUpModule():
    _outer_setup()
    with psycopg.connect(core._server.get_uri(database="tmpl"), autocommit=True) as c:
        c.execute((ROOT / "catalog_sources_seed.sql").read_text(encoding="utf-8"))


NEED = {"topic": "manufacturing", "measure": "share of jobs", "level": "state", "year_first": 1998, "year_last": 2023}


class SourceSearch(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def enable(self, per_day=30):
        self.admin("update control set ai_enabled = true, source_search_per_day = %s returning 1", per_day)

    def svc(self, sql, *args):
        return self.db.as_("service").one(sql, *args)

    def gap(self, owner=RYAN, text="county crime by year", reason="no_such_data", key="crime|county", nearest=(), need=NEED):
        return self.svc("select log_data_gap(%s, null, %s, %s::jsonb, %s, %s, %s::text[])", owner, text, json.dumps(need), reason, key, list(nearest))

    # -- the catalog the matcher reads
    def test_the_seed_carries_the_facts_the_matcher_checks(self):
        row = self.admin("select level, year_first, year_last, cadence, topic, measure, derived, runnable "
                         "from catalog_sources where id = 'cbp_manufacturing_share_state'")
        self.assertEqual(row, ("state", 1998, 2023, "annual", "Business", "Manufacturing: share of CBP-covered jobs", True, True))
        self.assertEqual(self.admin("select level from catalog_sources where id = 'bps_county_permits'"), "county")
        self.assertGreaterEqual(self.admin("select count(*) from catalog_sources where level is not null"), 90)
        rows = self.svc("select count(*) from source_search_catalog()")
        self.assertEqual(rows, self.admin("select count(*) from catalog_sources"))
        for who in (RYAN, OTHER, "anon"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select count(*) from source_search_catalog()")

    # -- starting a search
    def test_a_search_needs_the_switch_on_a_person_and_room_under_the_cap(self):
        with self.assertRaisesRegex(psycopg.Error, "switched off"):
            self.svc("select source_search_reserve(%s)", RYAN)
        self.enable(per_day=2)
        self.svc("select source_search_reserve(%s)", RYAN)
        self.svc("select source_search_reserve(%s)", RYAN)
        with self.assertRaisesRegex(psycopg.Error, "today's limit"):
            self.svc("select source_search_reserve(%s)", RYAN)
        self.svc("select source_search_reserve(%s)", OTHER)                          # caps are per person
        with self.assertRaises(psycopg.Error):
            self.svc("select source_search_reserve(%s)", WORKER)                      # a worker account is not a person
        self.admin("update source_searches set created_at = now() - interval '25 hours' where owner_id = %s returning 1", RYAN)
        self.svc("select source_search_reserve(%s)", RYAN)                            # the window rolls
        for who in (RYAN, OTHER, WORKER, "anon"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select source_search_reserve(%s)", RYAN)

    def test_usage_is_priced_and_unknown_is_never_zero(self):
        self.enable()
        sid = self.svc("select source_search_reserve(%s)", RYAN)
        usage = {"model": "claude-haiku-4-5", "input_tokens": 1000, "output_tokens": 200, "cache_read_input_tokens": 8000,
                 "cache_creation_input_tokens": 0, "latency_ms": 900}
        cost = self.svc("select source_search_finish(%s, 'done', 'suggested', 3, 'cbp_manufacturing_share_state', %s::jsonb)", sid, json.dumps(usage))
        self.assertEqual(float(cost), (1000 * 1.0 + 200 * 5.0 + 8000 * 0.10) / 1e6)
        row = self.admin("select status, outcome, suggested, recommended_id, cost_usd is not null from source_searches where id = %s", sid)
        self.assertEqual(row, ("done", "suggested", 3, "cbp_manufacturing_share_state", True))
        with self.assertRaisesRegex(psycopg.Error, "Search not found"):               # a finished search can't be finished again
            self.svc("select source_search_finish(%s, 'done', 'suggested', 0, null, '{}'::jsonb)", sid)
        sid2 = self.svc("select source_search_reserve(%s)", RYAN)
        self.assertIsNone(self.svc("select source_search_finish(%s, 'failed', 'error', 0, null, %s::jsonb)", sid2,
                                   json.dumps({"model": "claude-haiku-4-5", "error": "boom"})))          # unknown counts: no cost
        self.assertIsNone(self.admin("select cost_usd from source_searches where id = %s", sid2))

    def test_no_request_text_is_kept_with_a_search(self):
        cols = [r[0] for r in self.db.as_(None).all("select column_name from information_schema.columns where table_name = 'source_searches'")]
        self.assertFalse([c for c in cols if "text" in c or "prompt" in c or "request" in c], cols)

    # -- the data-gap queue
    def test_a_gap_is_logged_capped_and_closed_in_shape(self):
        self.gap(nearest=["bps_county_permits"])
        row = self.admin("select request_text, reason, need_key, nearest_ids, need->>'topic' from data_gaps")
        self.assertEqual(row, ("county crime by year", "no_such_data", "crime|county", ["bps_county_permits"], "manufacturing"))
        self.gap(text="x" * 900, key="long|one")
        self.assertEqual(self.admin("select max(char_length(request_text)) from data_gaps"), 500)
        for kw in ({"reason": "because"}, {"key": "Bad Key!"}, {"key": ""}, {"text": "   "}, {"nearest": list("abcdefg")}):
            with self.subTest(kw=kw), self.assertRaises(psycopg.Error):
                self.gap(**kw)
        for who in (RYAN, OTHER, "anon"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select log_data_gap(%s, null, 'x', '{}'::jsonb, 'no_such_data', 'k', '{}'::text[])", RYAN)
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("insert into data_gaps (owner_id, request_text, need, reason, need_key) "
                                  "values (%s, 'x', '{}', 'no_such_data', 'k') returning 1", RYAN)

    def test_twelve_months_then_gone(self):
        self.gap(text="old one", key="old|one")
        self.admin("update data_gaps set created_at = now() - interval '13 months' returning 1")
        self.gap(text="new one", key="new|one")
        self.assertEqual([r[0] for r in self.db.as_(None).all("select request_text from data_gaps")], ["new one"])

    def test_people_see_and_delete_only_their_own_requests(self):
        self.gap(owner=RYAN, text="mine", key="a|b")
        self.gap(owner=OTHER, text="theirs", key="a|b")
        self.assertEqual([r[0] for r in self.db.as_(RYAN).all("select request_text from data_gaps")], ["mine"])
        self.assertEqual(self.db.as_("anon").c.execute("select 1").fetchone()[0], 1)
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select count(*) from data_gaps")
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("update data_gaps set request_text = 'x' returning 1")
        self.assertEqual(self.db.as_(RYAN).one("select delete_my_data_gaps()"), 1)
        self.assertEqual(self.admin("select count(*) from data_gaps"), 1)
        self.assertEqual(self.admin("select request_text from data_gaps"), "theirs")
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select delete_my_data_gaps()")
        self.admin("delete from auth.users where id = %s returning 1", OTHER)           # account deletion takes them too
        self.assertEqual(self.admin("select count(*) from data_gaps"), 0)

    def test_admins_see_counts_first_and_texts_on_demand(self):
        self.admin("insert into app_admins (user_id) values (%s) returning 1", RYAN)
        for who, text in ((RYAN, "crime by county"), (OTHER, "crime in counties"), (OTHER, "county crime again")):
            self.gap(owner=who, text=text, key="crime|county", reason="no_such_data", nearest=["bps_county_permits"])
        self.gap(owner=RYAN, text="city permits", key="permits|city", reason="geography_too_fine")
        rows = self.db.as_(RYAN).all("select need_key, asks, people, reason, topic, level, years, nearest_ids from data_gaps_by_need(30)")
        self.assertEqual(rows[0], ("crime|county", 3, 2, "no_such_data", "manufacturing", "state", "1998 to 2023", ["bps_county_permits"]))
        self.assertEqual(rows[1][:3], ("permits|city", 1, 1))
        texts = self.db.as_(RYAN).all("select request_text from data_gap_requests('crime|county')")
        self.assertEqual(len(texts), 3)
        for who in (OTHER, WORKER, "anon"):
            for sql in ("select * from data_gaps_by_need(30)", "select * from data_gap_requests('crime|county')"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql)
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("select * from data_gaps_by_need(0)")


if __name__ == "__main__":
    unittest.main()
