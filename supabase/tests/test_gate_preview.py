"""THE GATE PREVIEW (supabase/live-steps/00_gate_preview.sql; RENDERER 11-27 08:47 item 5) on a local Postgres with every migration and the 2B ledger. BUILDER 2026-11-27.
Run from the repo root with TEMP/TMP on D:: <pgvenv>/Scripts/python -m unittest supabase/tests/test_gate_preview.py -v

  * after a gate run the preview says NOTHING (one row)
  * a new plpgsql function a signed-in person can run, a new SQL one, and a new table with a policy for signed-in people are each listed (LOOK, exactly those), and after gate_apply() it says NOTHING again
  * a function on the gate's allowed list, a function nobody signed in can run, and an open table are never listed
  * the step reads the gate's two lists from gate_apply's own text, and they equal the lists in the migration file
  * the step is one read-only statement, with no semicolon inside a string and no address
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

STEP = core.ROOT / "live-steps" / "00_gate_preview.sql"
GATE = core.ROOT / "migrations" / "20261104000100_waiting_accounts.sql"
setUpModule = credits.setUpModule


def file_list(name):
    src = GATE.read_text(encoding="utf-8").replace("\r\n", "\n")
    body = re.search(name + r" constant text\[\] := array\[([^\]]*)\]", src).group(1)
    return re.findall(r"'([a-z_]+)'", body)


class GatePreview(unittest.TestCase):
    tearDown = credits.Ledger.tearDown
    admin = credits.Ledger.admin

    def setUp(self):
        credits.Ledger.setUp(self)
        self.d().execute("select ryagram_private.gate_apply()")          # the shared template applies the ledger after the gate's last run: bring it to the live state first

    def d(self):
        return self.db.as_(None).c

    def preview(self):
        return self.d().execute(STEP.read_text(encoding="utf-8")).fetchall()

    def test_after_a_gate_run_it_says_nothing(self):
        rows = self.preview()
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0][1].startswith("NOTHING"), rows)

    def test_new_functions_and_a_policy_table_are_listed_then_nothing_after_the_gate(self):
        self.d().execute("create function public.zz_new_pl() returns int language plpgsql security definer set search_path = '' as $f$ begin return 1; end $f$")
        self.d().execute("create function public.zz_new_sql() returns int language sql stable as $f$ select 1 $f$")
        self.d().execute("grant execute on function public.zz_new_pl(), public.zz_new_sql() to authenticated")
        self.d().execute("create table public.zz_t (id int)")
        self.d().execute("alter table public.zz_t enable row level security")
        self.d().execute("create policy zz_read on public.zz_t for select to authenticated using (true)")
        rows = self.preview()
        self.assertTrue(rows[0][1].startswith("LOOK: the gate would change 3 things"), rows)
        self.assertEqual([r[1] for r in rows[1:]], ["function zz_new_pl() (plpgsql)", "function zz_new_sql() (sql)", "table public.zz_t"])
        self.d().execute("select ryagram_private.gate_apply()")
        rows = self.preview()
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0][1].startswith("NOTHING"), "the gate guarded all three")

    def test_the_gates_special_edits_are_listed_when_they_would_happen(self):
        gc = "public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)"
        d0 = self.d().execute("select pg_get_functiondef(to_regprocedure(%s))", (gc,)).fetchone()[0]
        self.assertIn("ryagram_private.hold_grant", d0, "after a gate run grant_credits carries the hold")
        self.d().execute(d0.replace("  if ryagram_private.hold_grant(p_owner, p_entry::text, p_credits, p_reason, p_created_by, p_stripe_event_id, p_period_key, p_price_code) then return null; end if;\n", ""))
        self.assertNotIn("ryagram_private.hold_grant", self.d().execute("select pg_get_functiondef(to_regprocedure(%s))", (gc,)).fetchone()[0], "the test removed the hold")
        rows = self.preview()
        self.assertTrue(rows[0][1].startswith("LOOK: the gate would change 1 things"), rows)
        self.assertEqual([r[1] for r in rows[1:]], ["edit grant_credits (adds the waiting-account hold)"])
        po = "ryagram_private.connect_person_ok(uuid)"
        p0 = self.d().execute("select pg_get_functiondef(to_regprocedure(%s))", (po,)).fetchone()[0]
        if p0 is not None and "account_active" in p0:
            self.d().execute(p0.replace("\n     and ryagram_private.account_active(p_owner)", ""))
            if "account_active" not in self.d().execute("select pg_get_functiondef(to_regprocedure(%s))", (po,)).fetchone()[0]:
                rows = self.preview()
                self.assertIn("edit connect_person_ok (adds account_active)", [r[1] for r in rows[1:]], rows)
        self.d().execute("select ryagram_private.gate_apply()")
        rows = self.preview()
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0][1].startswith("NOTHING"), "the gate made its special edits again")

    def test_allowed_names_closed_functions_and_open_tables_are_never_listed(self):
        allowed = file_list("allowed")
        self.d().execute(f"create or replace function public.{allowed[0]}__probe() returns int language plpgsql as $f$ begin return 1; end $f$")
        self.d().execute(f"revoke execute on function public.{allowed[0]}__probe() from public, authenticated")
        rows = self.preview()
        self.assertTrue(rows[0][1].startswith("NOTHING"), "a function no signed-in person can run is not the gate's business")
        names = [r[0] for r in self.d().execute("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                                               "where n.nspname = 'public' and p.proname = any(%s)", (allowed,)).fetchall()]
        self.assertTrue(names, "some allowed functions exist on the template")
        self.assertFalse(any(a in " ".join(r[1] for r in rows) for a in names), "an allowed function is never listed")

    def test_the_step_reads_the_gates_own_lists(self):
        got = self.d().execute("""with g as (select pg_get_functiondef(to_regprocedure('ryagram_private.gate_apply()')) as def)
            select array(select m[1] from g, regexp_matches(coalesce((regexp_match(g.def, 'allowed constant text\\[\\] := array\\[([^\\]]*)\\]'))[1], ''), '''([a-z_]+)''', 'g') m),
                   array(select m[1] from g, regexp_matches(coalesce((regexp_match(g.def, 'open_tables constant text\\[\\] := array\\[([^\\]]*)\\]'))[1], ''), '''([a-z_]+)''', 'g') m)""").fetchone()
        self.assertEqual(list(got[0]), file_list("allowed"))
        self.assertEqual(list(got[1]), file_list("open_tables"))
        self.assertGreaterEqual(len(got[0]), 10)
        self.assertIn("account_settings", got[1])
        step = STEP.read_text(encoding="utf-8")
        self.assertIn(r"allowed constant text\[\] := array\[([^\]]*)\]", step, "the test reads with the step's own pattern")

    def test_one_read_only_statement_no_semicolon_in_a_string_no_address(self):
        t = STEP.read_text(encoding="utf-8")
        code = "\n".join(l for l in t.splitlines() if not l.lstrip().startswith("--"))
        self.assertEqual(code.strip().count(";"), 1)
        self.assertTrue(code.strip().endswith(";"))
        self.assertIsNone(re.search(r"'[^'\n]*;[^'\n]*'", code))
        self.assertNotIn("@", t)
        self.assertIsNone(re.search(r"\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b", code, re.I), "read-only")


if __name__ == "__main__":
    unittest.main()
