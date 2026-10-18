"""Wide files in the upload SQL (migration 20261018000100, Q6; ENGINE + WEB, 2026-10-18) on a local Postgres.

The reader melts a wide file in memory and reports the LONG form; the person ticks "These columns are years"; the mapping carries
`melt_wide` and optionally `wide_prefix`. The five tests WEB listed, plus the rest of the rule:

  1. a wide file WITHOUT melt_wide is refused, with the new sentence;
  2. melt_wide with a good prefix is accepted;
  3. melt_wide on a LONG file is refused;
  4. a prefix outside wide_groups is refused;
  5. an index beyond the LONG columns is refused;
  + an EMPTY prefix means wide_chosen (accepted); an OLD wide report (no wide_groups) keeps the OLD refusal; the report's own closed
    shape (wide_groups, wide_chosen) is enforced; every old report and mapping still validates exactly as before.

    pgvenv/Scripts/python -m unittest supabase/tests/test_byod_wide_sql.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_uploads as T  # noqa: E402

RYAN = core.RYAN
setUpModule = T.setUpModule
LONG_COLS = [("State", "place", ["Alabama", "Texas"]), ("period", "period", ["2019", "2020"]), ("rent", "number", ["100", "110"])]
GROUPS = [{"prefix": "rent", "first": "2019", "last": "2021", "count": 3}, {"prefix": "income", "first": "2019", "last": "2021", "count": 3}]
MAPPING = dict(T.MAPPING, measure_names={"2": "Rent"})


def wide_report(**over):
    r = T.report(columns=LONG_COLS, guess={"place_index": 0, "period_index": 1, "value_indexes": [2], "geography": "us_states",
                                           "cadence": "annual", "wide": True}, wide_groups=GROUPS, wide_chosen="rent")
    r.update(over)
    return r


class WideSql(core.Base):
    admin = T.Uploads.admin
    create = T.Uploads.create
    put_file = T.Uploads.put_file
    uploaded = T.Uploads.uploaded
    read_by_worker = T.Uploads.read_by_worker

    def confirm(self, ds, mapping):
        """Confirm as the person (confirm_dataset_mapping returns void). True when it did not raise."""
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(mapping))
        return True

    def with_report(self, rep):
        ds, _ = self.uploaded()
        self.read_by_worker(ds, rep)
        return ds

    def refused(self, ds, mapping, regex):
        with self.assertRaisesRegex(psycopg.Error, regex):
            self.confirm(ds, mapping)
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "pending_validation", "a refused mapping approves nothing")

    # -- the five tests WEB listed
    def test_1_a_wide_file_without_melt_wide_is_refused_with_the_new_sentence(self):
        ds = self.with_report(wide_report())
        self.refused(ds, MAPPING, r'Tick "These columns are years" and confirm')
        self.refused(ds, dict(MAPPING, melt_wide=False), r'Tick "These columns are years" and confirm')

    def test_2_melt_wide_with_a_good_prefix_is_accepted(self):
        ds = self.with_report(wide_report())
        self.assertTrue(self.confirm(ds, dict(MAPPING, melt_wide=True, wide_prefix="income")))
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "approved")
        m = self.admin("select mapping from datasets where id = %s", ds)
        self.assertEqual((m["melt_wide"], m["wide_prefix"]), (True, "income"), "the confirmed mapping is stored with both keys")

    def test_3_melt_wide_on_a_long_file_is_refused(self):
        ds = self.with_report(T.report())
        self.refused(ds, dict(MAPPING, melt_wide=True), "does not have its years across the columns")
        self.refused(ds, dict(MAPPING, melt_wide=True, wide_prefix=""), "does not have its years across the columns")
        self.assertTrue(self.confirm(ds, dict(MAPPING, melt_wide=False)), "CONTROL: melt_wide false on a long file is fine")

    def test_4_a_prefix_outside_wide_groups_is_refused(self):
        ds = self.with_report(wide_report())
        self.refused(ds, dict(MAPPING, melt_wide=True, wide_prefix="nope"), "not one of the file's year columns")
        self.refused(ds, dict(MAPPING, melt_wide=True, wide_prefix="Rent"), "not one of the file's year columns")     # case matters
        self.assertTrue(self.confirm(ds, dict(MAPPING, melt_wide=True, wide_prefix="rent")), "CONTROL: a group's own prefix")

    def test_5_an_index_beyond_the_long_columns_is_refused(self):
        ds = self.with_report(wide_report())
        # the report lists 3 LONG columns (State, period, rent); the file itself has 9: an index of the FILE is not an index of the report
        self.refused(ds, dict(MAPPING, value_indexes=[7], banded_index=7, measure_names={"7": "X"}, melt_wide=True), "isn't in the file")
        self.refused(ds, dict(MAPPING, value_indexes=[3], banded_index=3, measure_names={"3": "X"}, melt_wide=True), "isn't in the file")
        self.assertTrue(self.confirm(ds, dict(MAPPING, melt_wide=True)), "CONTROL: the long columns' own indexes")

    # -- WEB's note (a) and the rest of the rule
    def test_an_empty_prefix_means_wide_chosen(self):
        ds = self.with_report(wide_report())
        self.assertTrue(self.confirm(ds, dict(MAPPING, melt_wide=True, wide_prefix="")))
        self.assertEqual(self.admin("select mapping->>'wide_prefix' from datasets where id = %s", ds), "", "stored as sent; the worker reads empty as the default group")
        ds2 = self.with_report(wide_report())
        self.assertTrue(self.confirm(ds2, dict(MAPPING, melt_wide=True)), "and no wide_prefix at all is the same")

    def test_an_old_wide_report_without_groups_keeps_the_old_refusal(self):
        ds = self.with_report(T.report(guess={"place_index": 0, "period_index": 1, "value_indexes": [2], "geography": None, "cadence": None, "wide": True}))
        self.refused(ds, dict(MAPPING, melt_wide=True), "Put the years in one column, with one row per place and year, and upload it again")

    def test_the_mapping_keys_are_typed(self):
        ds = self.with_report(wide_report())
        for name, m in {"melt_wide as text": dict(MAPPING, melt_wide="yes"), "melt_wide as a number": dict(MAPPING, melt_wide=1),
                        "wide_prefix without melt_wide": dict(MAPPING, wide_prefix="rent"),
                        "wide_prefix with melt_wide false": dict(MAPPING, melt_wide=False, wide_prefix="rent"),
                        "wide_prefix as a number": dict(MAPPING, melt_wide=True, wide_prefix=5),
                        "a 41-character prefix": dict(MAPPING, melt_wide=True, wide_prefix="x" * 41),
                        "an unknown key still refused": dict(MAPPING, melt_wide=True, axis=1)}.items():
            with self.subTest(name), self.assertRaises(psycopg.Error):
                self.confirm(ds, m)
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "pending_validation")

    def test_the_reports_own_closed_shape_is_enforced(self):
        good = wide_report()
        self.assertTrue(self.db.as_(None).one("select ryagram_private.ingest_report_ok(%s::jsonb)", json.dumps(good)))
        bad = {
            "groups on a LONG report": T.report(wide_groups=GROUPS, wide_chosen="rent"),
            "chosen without groups": wide_report(wide_groups=None) if False else {k: v for k, v in good.items() if k != "wide_groups"},
            "nine groups": wide_report(wide_groups=GROUPS * 5),
            "no groups": wide_report(wide_groups=[]),
            "a group of two years": wide_report(wide_groups=[dict(GROUPS[0], count=2)], wide_chosen="rent"),
            "a stray key in a group": wide_report(wide_groups=[dict(GROUPS[0], extra=1)]),
            "a 41-character prefix": wide_report(wide_groups=[dict(GROUPS[0], prefix="x" * 41)], wide_chosen="x" * 41),
            "a chosen prefix that is not a group": wide_report(wide_chosen="nope"),
            "groups not an array": wide_report(wide_groups={"prefix": "rent"}),
            "a count that is text": wide_report(wide_groups=[dict(GROUPS[0], count="3")]),
        }
        for name, r in bad.items():
            with self.subTest(name):
                self.assertFalse(self.db.as_(None).one("select ryagram_private.ingest_report_ok(%s::jsonb)", json.dumps(r)), name)
        ds, _ = self.uploaded()
        w = self.db.as_(core.WORKER)
        claimed = w.one("select * from claim_next_ingest()")
        with self.assertRaises(psycopg.Error):
            w.one("select report_ingest(%s, %s::jsonb) is null", claimed[0], json.dumps(bad["a chosen prefix that is not a group"]))

    def test_everything_old_still_validates_exactly_as_before(self):
        self.assertTrue(self.db.as_(None).one("select ryagram_private.ingest_report_ok(%s::jsonb)", json.dumps(T.report())))
        ds = self.with_report(T.report())
        self.assertTrue(self.confirm(ds, T.MAPPING))
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "approved")
        ds2 = self.with_report(T.report())
        with self.assertRaises(psycopg.Error):
            self.confirm(ds2, dict(T.MAPPING, place_index="0"))


if __name__ == "__main__":
    unittest.main()
