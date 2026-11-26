"""LIVE STEPS 73 AND 73b, THE OHIO COUNTY RATE LOAD (tools/gen-ohio-rate-load.py), on a local Postgres. CONNECT, 2026-11-26.
The generator turns the Department of Taxation's county table (a CSV) into live step 73 (load the rates) and 73b (put the Stripe Tax Rate ids on them). This test uses a MADE-UP table (Testshire 01 to 88 with made-up rates): the real numbers only ever come from the Department's CSV.
Run from the repo root with TEMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_ohio_rate_load.py -v

What it proves, each with the opposite case beside it
  * the generator REFUSES a wrong count, a repeated county, a name ending in County, a rate below the state's 5.75 or above 9, three decimals, a wrong header, odd spaces: it never guesses;
  * step 73 part 2 loads exactly 88 counties and one tax_rates row per distinct rate (Stripe id empty), and refuses a list with a county missing, a rate out of range or a repeated county, changing nothing;
  * running it twice changes nothing; a new quarter's file moves a county to its new rate, switches off a rate nobody uses any more and KEEPS the Stripe id of a rate that stayed;
  * step 73b refuses placeholders, a wrong shape, a repeated id and a list that is not exactly the active rates; with real ids it sets them.
"""
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

ROOT = core.ROOT
GEN = ROOT.parent / "tools" / "gen-ohio-rate-load.py"
_server = None
_count = 0
RATES = ["7.25", "7.50", "8.00"]


def csv_text(mutate=None, header="county,total_rate_percent"):
    rows = [(f"Testshire {i:02d}", RATES[i % 3]) for i in range(1, 89)]
    if mutate:
        rows = mutate(rows)
    return "# made-up table for the test, not a real quarter\n" + header + "\n" + "\n".join(f"{n},{r}" for n, r in rows) + "\n"


def parts(text):
    return {int(m.group(1)): m.group(2) for m in re.finditer(r"-- PART (\d)[^\n]*\n(.*?)(?=\n-- PART \d|\Z)", text, re.S)}


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-ohiorates-")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmploh")
        c.execute("create database tmploh")
    with psycopg.connect(_server.get_uri(database="tmploh"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in core.MIGRATIONS:
            c.execute(path.read_text(encoding="utf-8"))


class OhioRateLoad(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"oh{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name} template tmploh")
        self.db = core.Db(_server.get_uri(database=self.name))
        self.tmp = tempfile.TemporaryDirectory(prefix="ohio-gen-")

    def tearDown(self):
        self.db.c.close()
        self.tmp.cleanup()

    def gen(self, text, counties=88):
        src = Path(self.tmp.name) / "rates.csv"
        src.write_text(text, encoding="utf-8")
        out = Path(self.tmp.name) / "out"
        r = subprocess.run([sys.executable, "-B", str(GEN), str(src), "--counties", str(counties), "--out-dir", str(out)], capture_output=True, text=True)
        return r, out

    def load(self, text=None):
        r, out = self.gen(text or csv_text())
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return parts((out / "73_ohio_county_rates_load.sql").read_text(encoding="utf-8")), (out / "73b_ohio_stripe_tax_rate_ids.sql").read_text(encoding="utf-8")

    def run_sql(self, sql):
        return self.db.as_(None).c.execute(sql)

    def test_the_generator_refuses_what_does_not_look_right(self):
        bad = {
            "87 counties": lambda rows: rows[:-1],
            "a repeated county": lambda rows: rows[:-1] + [rows[0]],
            "a name ending in County": lambda rows: [("Testshire 01 County", rows[0][1])] + rows[1:],
            "a rate below the state's": lambda rows: [(rows[0][0], "5.50")] + rows[1:],
            "a rate above 9": lambda rows: [(rows[0][0], "9.50")] + rows[1:],
            "three decimals": lambda rows: [(rows[0][0], "7.255")] + rows[1:],
            "not a number": lambda rows: [(rows[0][0], "seven")] + rows[1:],
            "odd spaces": lambda rows: [("Testshire  01", rows[0][1])] + rows[1:],
        }
        for what, mutate in bad.items():
            r, out = self.gen(csv_text(mutate))
            self.assertNotEqual(r.returncode, 0, what)
            self.assertIn("REFUSED", r.stdout + r.stderr, what)
            self.assertFalse((out / "73_ohio_county_rates_load.sql").exists(), what)
        r, _ = self.gen(csv_text(header="name,rate"))
        self.assertNotEqual(r.returncode, 0)

    def test_step_73_loads_88_counties_and_one_row_per_distinct_rate_and_twice_changes_nothing(self):
        p, _ = self.load()
        self.assertEqual(self.run_sql(p[1]).fetchone(), (0, 0, 0))
        self.run_sql(p[2])
        self.assertEqual(self.run_sql(p[3]).fetchone(), (88, 3, 0))
        rates = dict(self.run_sql("select code, percent from public.tax_rates order by code").fetchall())
        self.assertEqual({k: str(v) for k, v in rates.items()}, {"oh_0725": "7.2500", "oh_0750": "7.5000", "oh_0800": "8.0000"})
        self.assertEqual(self.run_sql("select rate_code from public.ohio_county_rate where county = 'Testshire 03'").fetchone()[0], "oh_0725")     # i = 3 -> RATES[0]
        self.assertEqual(self.run_sql("select rate_code from public.ohio_county_rate where county = 'Testshire 04'").fetchone()[0], "oh_0750")
        self.run_sql(p[2])
        self.assertEqual(self.run_sql(p[3]).fetchone(), (88, 3, 0))

    def test_part_2_refuses_a_tampered_list_and_changes_nothing(self):
        p, _ = self.load()
        sql = p[2]
        first = re.search(r'\["Testshire 01","[0-9.]+"\],', sql).group(0)          # the first entry, with its comma
        second = re.search(r'\["Testshire 02","[0-9.]+"\]', sql).group(0)
        for what, old, new, word in (("a county missing", first, "", "does not have 88"),
                                      ("a rate out of range", second, '["Testshire 02","5.00"]', "outside"),
                                      ("a county twice", second, '["Testshire 01","7.75"]', "twice")):
            with self.assertRaises(psycopg.Error, msg=what) as cm:
                self.run_sql(sql.replace(old, new, 1))
            self.assertIn(word, str(cm.exception), what)
        self.assertEqual(self.run_sql(p[1]).fetchone(), (0, 0, 0))

    def test_a_new_quarter_moves_a_county_switches_off_an_unused_rate_and_keeps_a_stayed_rates_stripe_id(self):
        p, ids = self.load()
        self.run_sql(p[2])
        real = re.sub(r'"oh_0725": "txr_REPLACE_ME"', '"oh_0725": "txr_A1"', ids)
        real = re.sub(r'"oh_0750": "txr_REPLACE_ME"', '"oh_0750": "txr_B1"', real)
        real = re.sub(r'"oh_0800": "txr_REPLACE_ME"', '"oh_0800": "txr_C1"', real)
        self.run_sql(real)
        self.assertEqual(dict(self.run_sql("select code, stripe_tax_rate_id from public.tax_rates").fetchall()), {"oh_0725": "txr_A1", "oh_0750": "txr_B1", "oh_0800": "txr_C1"})
        # next quarter: every county that was 7.25 becomes 7.50 (so 7.25 is unused), one county becomes 8.25 (a new rate)
        def next_q(rows):
            out = [(n, "7.50" if r == "7.25" else r) for n, r in rows]
            return [(out[0][0], "8.25")] + out[1:]
        p2, _ = self.load(csv_text(next_q))
        self.run_sql(p2[2])
        active = dict(self.run_sql("select code, active from public.tax_rates").fetchall())
        self.assertEqual(active, {"oh_0725": False, "oh_0750": True, "oh_0800": True, "oh_0825": True})
        stripe = dict(self.run_sql("select code, stripe_tax_rate_id from public.tax_rates").fetchall())
        self.assertEqual((stripe["oh_0750"], stripe["oh_0800"], stripe["oh_0825"]), ("txr_B1", "txr_C1", None), "a rate that stayed keeps its Stripe id; the new one has none yet")
        self.assertEqual(self.run_sql("select rate_code from public.ohio_county_rate where county = 'Testshire 01'").fetchone()[0], "oh_0825")
        self.assertEqual(self.run_sql(p2[3]).fetchone(), (88, 3, 2))

    def test_step_73b_refuses_placeholders_wrong_shapes_repeats_and_a_wrong_list(self):
        p, ids = self.load()
        self.run_sql(p[2])
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(ids)
        self.assertIn("no real Stripe Tax Rate id", str(cm.exception))
        good = {"oh_0725": "txr_A1", "oh_0750": "txr_B1", "oh_0800": "txr_C1"}

        def with_ids(m):
            s = ids
            for k, v in m.items():
                s = s.replace(f'"{k}": "txr_REPLACE_ME"', f'"{k}": "{v}"')
            return s
        for what, m, word in (("wrong shape", {**good, "oh_0750": "price_B1"}, "no real Stripe Tax Rate id"),
                              ("a repeated id", {**good, "oh_0750": "txr_A1"}, "same Stripe id")):
            with self.assertRaises(psycopg.Error, msg=what) as cm:
                self.run_sql(with_ids(m))
            self.assertIn(word, str(cm.exception), what)
        self.assertEqual(self.run_sql("select count(*) from public.tax_rates where stripe_tax_rate_id is not null").fetchone()[0], 0)
        with self.assertRaises(psycopg.Error) as cm:                                         # a list that is not the active rates
            self.run_sql(with_ids(good).replace('"oh_0800": "txr_C1"', '"oh_0899": "txr_C1"'))
        self.assertIn("not exactly the active rates", str(cm.exception))
        self.run_sql(with_ids(good))
        self.assertEqual(self.run_sql("select count(*) from public.tax_rates where stripe_tax_rate_id is not null").fetchone()[0], 3)


if __name__ == "__main__":
    unittest.main()
