"""THE LIVE WINDOW, REHEARSED (CONNECT 2026-11-10; CC1 10:29 order B): Ryan's connector live window (proposals/CONNECT-RYAN-LIVE-STEPS-1109.md) run on a local Postgres, in his date order, exactly as he does it.

Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_live_window_rehearsal.py -v

THE STARTING POINT is what live is today: every migration that is on L-Ai main (up to 20261106000100), in the order live used. THEN, as Ryan does, each file of the window is pasted whole and run (one text, one script, begin and commit inside it):
    Step 2   20261109000100_film_cards.sql            check: select count(*) from public.film_card_requests            -> 0
    Step 3   20261109000200_county_requests.sql       check: select count(*) from public.county_requests               -> 0
    Step 3b  20261109000300_ask_locks.sql             check: every row 'locked' is true (it CHANGES three live functions)
    Step 3c  20261110000100_connect_cimd.sql          check: listed = 1 and function_there = true
    Step 3d  20261110000200_waitlist_join.sql         check: there = true and hits = 0
    Step 3e  connect-drafts/20261110000300_waitlist_close_direct_insert.sql   (only after the page is deployed)   check: closed = true
Each step is proved alone (its check says what the page says, its undo file puts back what was there, running it twice does no harm), and the WHOLE window is proved in order with every check, then every undo in the reverse order, and the database must be exactly what it was before the window (every function's text, every table and its columns).
The check queries below are the ones on Ryan's page, word for word; a test fails if the page (when it is on this computer) says anything else.
"""
import os
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

ROOT = core.ROOT
PAGE = Path(os.environ.get("RYAN_STEPS_PAGE", r"C:\Users\Ryan\Ryagram-logs\proposals\CONNECT-RYAN-LIVE-STEPS-1109.md"))
LEDGER = ROOT / "phase-2b" / "credits_ledger.sql"
STRIPE = ROOT / "phase-2b" / "stripe_test_mode.sql"
WAIT_MIG = next(m for m in core.MIGRATIONS if m.name.startswith("20261104000100_waiting_accounts"))
WINDOW_FILES = ["20261109000100_film_cards", "20261109000200_county_requests", "20261109000300_ask_locks", "20261110000100_connect_cimd", "20261110000200_waitlist_join"]
# THE ORDER LIVE USES (as test_waiting_accounts): the ledger and the Stripe file before the funnel migration; the waiting-accounts file and everything after it last. NOTHING of the window is in the starting point.
PRE = [*[m for m in core.MIGRATIONS if m.name < "20261017000900"], LEDGER, STRIPE, *[m for m in core.MIGRATIONS if "20261017000900" <= m.name < WAIT_MIG.name]]
POST = [m for m in core.MIGRATIONS if m.name > WAIT_MIG.name and not any(m.name.startswith(w) for w in WINDOW_FILES)]
MIG = ROOT / "migrations"
RB = ROOT / "rollbacks"
DRAFTS = ROOT / "connect-drafts"
FILM = (MIG / "20261109000100_film_cards.sql", RB / "20261109000100_film_cards_rollback.sql")
COUNTY = (MIG / "20261109000200_county_requests.sql", RB / "20261109000200_county_requests_rollback.sql")
LOCKS = (MIG / "20261109000300_ask_locks.sql", RB / "20261109000300_ask_locks_rollback.sql")
CIMD = (MIG / "20261110000100_connect_cimd.sql", RB / "20261110000100_connect_cimd_rollback.sql")
WAITLIST = (MIG / "20261110000200_waitlist_join.sql", RB / "20261110000200_waitlist_join_rollback.sql")
CLOSE = (DRAFTS / "20261110000300_waitlist_close_direct_insert.sql", RB / "20261110000300_waitlist_close_direct_insert_rollback.sql")
STEPS = [("Step 2 film cards", FILM), ("Step 3 county", COUNTY), ("Step 3b ask locks", LOCKS), ("Step 3c registration", CIMD), ("Step 3d waiting list", WAITLIST), ("Step 3e close the old door", CLOSE)]

# the check queries, as they are on Ryan's page
Q_FILM = "select count(*) from public.film_card_requests;"
Q_COUNTY = "select count(*) from public.county_requests;"
Q_LOCKS = ("select proname, position('pg_advisory_xact_lock' in pg_get_functiondef(oid)) > 0 as locked from pg_proc where pronamespace = 'public'::regnamespace "
           "and proname in ('connect_forecast_ask', 'connect_geo_ask', 'connect_geo_ask_shape') order by proname;")
Q_CIMD = "select (select count(*) from public.connect_cimd_allowlist) as listed, to_regprocedure('public.connect_cimd_client(text, text[])') is not null as function_there;"
Q_WAITLIST = "select to_regprocedure('public.join_waitlist(text, text, text)') is not null as there, (select count(*) from public.ryagram_waitlist_hits) as hits;"
Q_CLOSE = ("select not has_column_privilege('anon', 'public.ryagram_waitlist', 'email', 'insert') and not has_column_privilege('authenticated', 'public.ryagram_waitlist', 'email', 'insert') "
           "and not exists (select 1 from pg_policy where polrelid = 'public.ryagram_waitlist'::regclass and polcmd = 'a') as closed;")

_server = None
_count = 0


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-pg-window-")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists wpre")
        c.execute("create database wpre")
    with psycopg.connect(_server.get_uri(database="wpre"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in PRE:
            c.execute(path.read_text(encoding="utf-8"))
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("create database wlive template wpre")
    with psycopg.connect(_server.get_uri(database="wlive"), autocommit=True) as c:
        for path in [WAIT_MIG, *POST]:
            c.execute(path.read_text(encoding="utf-8"))
        c.execute("update public.ops_settings set auto_render = true, default_credits_per_day = 100000")


def inventory(c):
    """What is in the database that a window step could add or change: every function of public and ryagram_private with a hash of its text, every table with its columns, every policy."""
    funcs = c.execute("""select n.nspname || '.' || p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname in ('public', 'ryagram_private') and p.prokind = 'f' order by 1""").fetchall()
    tables = c.execute("""select table_schema || '.' || table_name, string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
                           where table_schema in ('public', 'ryagram_private') group by 1 order by 1""").fetchall()
    policies = c.execute("select schemaname || '.' || tablename, policyname, cmd from pg_policies where schemaname in ('public', 'ryagram_private') order by 1, 2").fetchall()
    grants = c.execute("""select table_schema || '.' || table_name, grantee, privilege_type from information_schema.table_privileges where table_schema = 'public'
                           and table_name in ('ryagram_waitlist') order by 1, 2, 3""").fetchall()
    cols = c.execute("""select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = 'ryagram_waitlist'
                         and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4""").fetchall()
    return {"functions": funcs, "tables": tables, "policies": policies, "grants": grants, "column grants": cols}


def diff(a, b):
    out = []
    for k in a:
        sa, sb = set(map(tuple, a[k])), set(map(tuple, b[k]))
        out += [f"{k}: only before: {x[0]}" for x in sorted(sa - sb)[:5]] + [f"{k}: only after: {x[0]}" for x in sorted(sb - sa)[:5]]
    return out


class Window(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"win{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name} template wlive")
        self.c = psycopg.connect(_server.get_uri(database=self.name), autocommit=True)

    def tearDown(self):
        self.c.close()

    def paste(self, path):
        """What Ryan does: the whole file, as one text, in the SQL editor."""
        self.c.execute(path.read_text(encoding="utf-8"))

    def q(self, sql):
        return self.c.execute(sql).fetchall()

    def check(self, step):
        """The page's check for this step, and what it must say."""
        if step == "Step 2 film cards":
            self.assertEqual(self.q(Q_FILM), [(0,)])
        elif step == "Step 3 county":
            self.assertEqual(self.q(Q_COUNTY), [(0,)])
        elif step == "Step 3b ask locks":
            self.assertEqual(self.q(Q_LOCKS), [("connect_forecast_ask", True), ("connect_geo_ask", True), ("connect_geo_ask_shape", True)])
        elif step == "Step 3c registration":
            self.assertEqual(self.q(Q_CIMD), [(1, True)])
        elif step == "Step 3d waiting list":
            self.assertEqual(self.q(Q_WAITLIST), [(True, 0)])
        elif step == "Step 3e close the old door":
            self.assertEqual(self.q(Q_CLOSE), [(True,)])
        else:
            self.fail(step)

    def unchecked(self, step):
        """What the check says BEFORE the step (or after its undo): the page's check must not already pass."""
        try:
            rows = self.q({"Step 2 film cards": Q_FILM, "Step 3 county": Q_COUNTY, "Step 3b ask locks": Q_LOCKS, "Step 3c registration": Q_CIMD,
                           "Step 3d waiting list": Q_WAITLIST, "Step 3e close the old door": Q_CLOSE}[step])
        except psycopg.Error:
            return True                                                  # the table is not there: the check cannot pass
        if step == "Step 3b ask locks":
            return all(not locked for _, locked in rows)
        if step == "Step 3c registration":
            return rows[0][1] is False if rows else True
        if step == "Step 3d waiting list":
            return rows[0][0] is False if rows else True
        if step == "Step 3e close the old door":
            return rows[0][0] is False
        return False

    # ---------------------------------------------------------------------------------------------- each step alone
    def test_each_step_alone_the_check_says_what_the_page_says_and_the_undo_puts_back_what_was_there(self):
        for step, (mig, undo) in STEPS:
            with self.subTest(step=step):
                if step == "Step 3e close the old door" and self.q("select to_regprocedure('public.join_waitlist(text, text, text)') is null")[0][0]:
                    self.paste(WAITLIST[0])                                    # its own precondition: the function must be there before the old door closes
                before = inventory(self.c)
                self.assertTrue(self.unchecked(step), f"{step}: the check must not already pass before the step")
                self.paste(mig)
                self.check(step)
                self.paste(undo)
                self.assertEqual(diff(before, inventory(self.c)), [], f"{step}: after its undo the database is what it was")
                self.assertTrue(self.unchecked(step), f"{step}: after its undo the check no longer passes")
                self.paste(mig)                                                # and it can be applied again after an undo
                self.check(step)

    def test_running_a_step_twice_does_no_harm_where_the_page_promises_it(self):
        for step, (mig, undo) in STEPS:
            if step in ("Step 2 film cards", "Step 3 county", "Step 3c registration", "Step 3d waiting list"):
                continue                                                         # a plain migration: running it twice is an error the page never asks for (a table that already exists)
            with self.subTest(step=step):
                if step == "Step 3e close the old door":
                    self.paste(WAITLIST[0])
                self.paste(mig)
                self.paste(mig)
                self.check(step)
                self.paste(undo)
                self.paste(undo)                                                 # the undo is safe twice

    # ---------------------------------------------------------------------------------------------- the whole window, in order, then every undo in the reverse order
    def test_the_whole_window_in_order_with_every_check_then_every_undo_in_reverse_leaves_the_database_exactly_as_it_was(self):
        before = inventory(self.c)
        for step, (mig, _) in STEPS:
            self.paste(mig)
            self.check(step)
        for step, _ in STEPS:                                                  # every check still says yes with all of the window on
            self.check(step)
        after = inventory(self.c)
        self.assertNotEqual(diff(before, after), [], "the window changed the database")
        for step, (_, undo) in reversed(STEPS):
            self.paste(undo)
        self.assertEqual(diff(before, inventory(self.c)), [], "after every undo in the reverse order the database is exactly what it was before the window: every function's text, every table and its columns, every policy and grant")

    def test_the_connector_function_list_is_what_the_pins_say_after_the_window(self):
        """The live check (01_after_migration_check.sql) counts the functions the connector's role may call; the window adds film card ask and get, county ask and get, and the registration function."""
        def callable_by_runner(c):
            return sorted(r[0] for r in c.execute("""select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('connect_runner', p.oid, 'execute') and p.proname like 'connect\\_%%'""").fetchall())
        before = callable_by_runner(self.c)
        for _, (mig, _) in STEPS:
            self.paste(mig)
        new = sorted(set(callable_by_runner(self.c)) - set(before))
        self.assertEqual(new, ["connect_cimd_client", "connect_county_ask", "connect_county_get", "connect_film_card_ask", "connect_film_card_get"])

    # ---------------------------------------------------------------------------------------------- the page says what the test ran
    def test_the_check_queries_in_this_file_are_the_ones_on_ryans_page_word_for_word(self):
        if not PAGE.exists():
            self.skipTest(f"Ryan's page is not on this computer ({PAGE}); set RYAN_STEPS_PAGE")
        text = PAGE.read_text(encoding="utf-8")
        for name, q in (("film", Q_FILM), ("county", Q_COUNTY), ("locks", Q_LOCKS), ("cimd", Q_CIMD), ("waitlist", Q_WAITLIST), ("close", Q_CLOSE)):
            self.assertIn(q.rstrip(";"), text.replace("\r\n", "\n"), f"the {name} check on the page is not the one this test runs")
        for path in (FILM[0], COUNTY[0], LOCKS[0], CIMD[0], WAITLIST[0], CLOSE[0], FILM[1], COUNTY[1], LOCKS[1], CIMD[1], WAITLIST[1], CLOSE[1]):
            rel = str(path.relative_to(ROOT.parent)).replace("/", "\\")
            self.assertIn(rel, text, f"the page does not name {rel}")


if __name__ == "__main__":
    unittest.main()
