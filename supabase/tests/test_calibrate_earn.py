"""CALIBRATE EARN RULES, revision 2 (migrations/20261127001100_calibrate_earn.sql, NOT APPLIED) on a local Postgres with the 2B credits ledger. BUILDER, 2026-11-27.
Plan: proposals/BUILDER-CALIBRATE-EARN-RULES-1127.md. DESIGN STAGE: written and py_compiled, NOT RUN yet (no Postgres in the design window).
Same setup as test_2b_credits.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    D:/Ryagram-scratch/WEB/pgvenv2/Scripts/python -B -m unittest supabase/tests/test_calibrate_earn.py -v

Must-fail style: every refusal sits beside the case that works, so a test cannot pass because nothing works.
  * who: switch, consent (and withdrawing it), 7 days AND a server-rendered film (a capture or purchase row; a PC-reported compilation is not one), workers, waiting, anon, service.
  * a connected AI's token is refused; the connector login can run only connect_calibration_status.
  * the server picks the known-answer items: always gold_per_round of them, never own footage; the page sees per-round item tokens, never item ids or gold flags.
  * gold: 18 earlier golds right then this round's two skipped earns nothing; the 20-answer window spans rounds.
  * own-footage answers earn nothing; too many too-fast answers pay 0; finish returns only {result, tenths, release_at}; an expired round is refused.
  * caps are rolling (24 h, not a UTC day) and count undone awards; every award waits 24 h; the global weekly budget holds across accounts.
  * the award ledger is append-only; the undo appends a reversal, takes back at most calibrate's own credits, never below zero.
  * the rollback refuses while an award is held; live step 84 answers as its header says.
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER        # two ordinary people here (neither is an admin in this template)
MIG = core.ROOT / "migrations" / "20261127001100_calibrate_earn.sql"
RB = core.ROOT / "rollbacks" / "20261127001100_calibrate_earn_rollback.sql"
STEP = core.ROOT / "live-steps" / "84_calibrate_check.sql"
START = "select * from public.calibrate_round_start()"
ANSWER = "select public.calibrate_answer(%s, %s, %s)"
FINISH = "select public.calibrate_round_finish(%s)"
CONSENT = "select public.calibrate_consent_set(%s)"
UNDO = "select ryagram_private.calibrate_award_undo(%s, %s)"
TICK = "select ryagram_private.calibrate_release_due()"
TABLES = ("public.calibrate_consents", "public.calibrate_rounds", "public.calibrate_answers", "public.calibrate_awards", "public.calibrate_releases",
          "public.calibrate_credit_moves", "ryagram_private.calibrate_items", "ryagram_private.calibrate_round_items", "ryagram_private.calibrate_points",
          "ryagram_private.calibrate_budget", "ryagram_private.calibrate_task_kinds", "ryagram_private.calibrate_rules")
SMALL = dict(round_size=6, gold_per_round=2, gold_round_min=2, rounds_per_day=60, daily_cap_tenths=1000, weekly_cap_tenths=5000, hold_hours=0, weekly_budget_credits=200)


def setUpModule():
    credits.setUpModule()


def statements(sql):
    """Statements outside comments and quoted strings (a ; inside quotes or a -- comment is not a statement end)."""
    out, cur, i, q = [], [], 0, False
    while i < len(sql):
        ch = sql[i]
        if not q and sql.startswith("--", i):
            i = sql.find("\n", i)
            i = len(sql) if i < 0 else i
            continue
        if ch == "'":
            q = not q
        if ch == ";" and not q:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    rest = "".join(cur).strip()
    return out + ([rest] if rest else [])


class CalibrateEarn(unittest.TestCase):
    tearDown = credits.Ledger.tearDown

    def setUp(self):
        credits.Ledger.setUp(self)

    # ------------------------------------------------------------------------------------------ helpers
    def d(self):
        return self.db.as_(None).c

    def one(self, who, sql, *args):
        return self.db.as_(who).one(sql, *args)

    def granted(self, who):
        return self.d().execute("select coalesce(sum(amount), 0) from public.credit_ledger where owner_id = %s and pool = 'granted'", (who,)).fetchone()[0]

    def rules(self, **kw):
        for k, v in kw.items():
            self.d().execute(f"update ryagram_private.calibrate_rules set {k} = %s", (v,))

    def small(self, **kw):
        self.rules(**{**SMALL, **kw})

    def replica(self, sql, *args):
        """The dashboard moving the clock on append-only rows: triggers are off for this one statement only."""
        c = self.d()
        c.execute("set session_replication_role = replica")
        try:
            c.execute(sql, args or None)
        finally:
            c.execute("set session_replication_role = origin")

    def switch(self, who, on=True):
        self.d().execute("insert into public.account_settings (owner_id, switches_on) values (%s, %s) on conflict (owner_id) do update set switches_on = excluded.switches_on",
                         (who, ["calibrate"] if on else []))

    def age(self, who, days):
        self.d().execute("update auth.users set created_at = now() - make_interval(days => %s) where id = %s", (days, who))

    def film(self, who):
        """A server-rendered film stands in as a purchase row (the gate counts 'capture' or 'purchase'); purchased credits never mix with 'granted'."""
        self.d().execute("insert into public.credit_ledger (owner_id, entry, pool, amount, reason, created_by) values (%s, 'purchase', 'purchased', 10, 'test pack', 'test')", (who,))

    def ready(self, who):
        self.switch(who)
        self.age(who, 8)
        self.film(who)
        self.one(who, CONSENT, True)

    def items(self, gold=40, plain=200, source="public_domain", owner=None, kind="is_phrase"):
        note = None if source == "own_app" else "test clip, public domain"
        for g in range(gold):
            self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, licence_note, media_ref, choices, is_gold, gold_answer) "
                             "values ('is_phrase', 'public_domain', 'test clip, public domain', %s, '{a,b}', true, 'a')", (f"pack-{g}",))
        for p in range(plain):
            ref = f"loc_{p:020d}" if source == "own_app" else f"site-{source}-{p}"
            self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, owner_id, licence_note, media_ref, choices) "
                             "values (%s, %s, %s, %s, %s, '{a,b}')", (kind, source, owner, note, ref))

    def token_item(self, token):
        return self.d().execute("select i.id, i.is_gold, i.source_kind from ryagram_private.calibrate_round_items x join ryagram_private.calibrate_items i on i.id = x.item_id "
                                "where x.item_token = %s", (token,)).fetchone()

    def start(self, who=RYAN):
        try:
            rows = self.db.as_(who).c.execute(START).fetchall()
        except psycopg.Error as e:
            self.fail(f"a round that was meant to start was refused: {e.sqlstate} {e.diag.message_primary}")
        self.assertTrue(rows)
        return rows[0][0], [r[1] for r in rows]

    def answer_all(self, who, rid, tokens, gold="right", pace_s=7):
        """gold: 'right', 'wrong' or 'skip'. Answers are then spread pace_s seconds apart on the server's clock (the dashboard moves the clock, nothing else)."""
        for t in tokens:
            _, is_gold, _ = self.token_item(t)
            ans = {"right": "a", "wrong": "b", "skip": "skip"}[gold] if is_gold else "a"
            self.one(who, ANSWER, rid, t, ans)
        self.d().execute("update public.calibrate_rounds set started_at = now() - make_interval(secs => %s) where id = %s", (pace_s * (len(tokens) + 1), rid))
        self.d().execute("update public.calibrate_answers a set answered_at = r.started_at + make_interval(secs => %s * n.k) "
                         "from public.calibrate_rounds r, (select id, row_number() over (order by id) as k from public.calibrate_answers where round_id = %s) n "
                         "where a.round_id = %s and r.id = a.round_id and n.id = a.id", (pace_s, rid, rid))

    def play(self, who=RYAN, gold="right", pace_s=7):
        rid, tokens = self.start(who)
        self.answer_all(who, rid, tokens, gold, pace_s)
        return rid, self.one(who, FINISH, rid)

    def refused(self, who, sql, *args, code="42501", hint=None):
        with self.assertRaises(psycopg.Error, msg=(who, sql, args)) as cm:
            self.db.as_(who).c.execute(sql, args or None)
        self.assertEqual(cm.exception.sqlstate, code, (who, sql, args, cm.exception))
        if hint:
            self.assertEqual(cm.exception.diag.message_hint, hint, (who, sql, cm.exception))
        return cm.exception.diag.message_primary

    def award_of(self, rid):
        return self.d().execute("select id from public.calibrate_awards where round_id = %s and kind = 'award'", (rid,)).fetchone()[0]

    # ------------------------------------------------------------------------------------------ who may play
    def test_switch_consent_and_the_gate_each_refuse_beside_the_case_that_works(self):
        self.items()
        self.small()
        self.age(RYAN, 8)
        self.film(RYAN)
        self.refused(RYAN, CONSENT, True, hint="calibrate_off")
        self.switch(OTHER)                                                     # someone else's switch opens nothing for me
        self.refused(RYAN, START, hint="calibrate_off")
        self.switch(RYAN)
        self.refused(RYAN, START, hint="calibrate_consent")
        self.one(RYAN, CONSENT, True)
        rid, tokens = self.start(RYAN)
        self.one(RYAN, CONSENT, False)                                         # withdrawn: closed again
        self.refused(RYAN, ANSWER, rid, tokens[0], "a", hint="calibrate_consent")

    def test_seven_days_AND_a_server_rendered_film_a_reported_compilation_is_not_one(self):
        self.items()
        self.small()
        self.switch(OTHER)
        self.one(OTHER, CONSENT, True)
        self.age(OTHER, 30)
        self.refused(OTHER, START, hint="calibrate_too_new")                   # old enough, no film
        self.film(OTHER)
        self.age(OTHER, 6)
        self.refused(OTHER, START, hint="calibrate_too_new")                   # a film, too young
        self.age(OTHER, 7)
        self.start(OTHER)
        src = self.d().execute("select prosrc from pg_proc where proname = 'calibrate_eligible'").fetchone()[0]
        self.assertNotIn("compilation", src)
        self.assertIn("'capture', 'purchase'", src)

    def test_a_worker_anon_and_the_service_key_are_refused(self):
        self.items()
        self.switch(WORKER)
        self.age(WORKER, 30)
        self.refused(WORKER, CONSENT, True)
        self.ready(RYAN)
        for who in ("anon", "service"):
            self.refused(who, START)
            self.refused(who, CONSENT, True)

    def test_a_connected_ai_token_is_refused_and_the_connector_login_runs_only_the_status_read(self):
        self.items()
        self.small()
        self.ready(RYAN)
        rid, tokens = self.start(RYAN)
        for sql, args in ((CONSENT, (True,)), (ANSWER, (rid, tokens[0], "a")), (FINISH, (rid,)), (START, ())):
            d = self.db.as_(RYAN)
            d.c.execute("select set_config('request.jwt.claims', %s, false)", ('{"sub": "%s", "role": "authenticated", "client_id": "x"}' % RYAN,))
            with self.assertRaises(psycopg.Error, msg=sql) as cm:
                d.c.execute(sql, args or None)
            self.assertEqual(cm.exception.sqlstate, "42501")
            d.c.execute("select set_config('request.jwt.claims', '', false)")
        self.assertEqual(self.d().execute("select count(*) from public.calibrate_answers").fetchone()[0], 0)
        self.one(RYAN, ANSWER, rid, tokens[0], "a")                            # the same person in the app: works
        if self.d().execute("select exists (select 1 from pg_roles where rolname = 'connect_runner')").fetchone()[0]:
            for fn in ("calibrate_answer(uuid,uuid,text)", "calibrate_round_finish(uuid)", "calibrate_consent_set(boolean)", "calibrate_round_start()"):
                self.assertFalse(self.d().execute("select has_function_privilege('connect_runner', %s::regprocedure, 'execute')", ("public." + fn,)).fetchone()[0], fn)
            self.assertTrue(self.d().execute("select has_function_privilege('connect_runner', 'public.connect_calibration_status(text)'::regprocedure, 'execute')").fetchone()[0])
        for name in ("calibrate_consent_set", "calibrate_round_start", "calibrate_answer", "calibrate_round_finish"):
            self.assertIn("calibrate_person()", self.d().execute("select prosrc from pg_proc where proname = %s", (name,)).fetchone()[0], name)

    # ------------------------------------------------------------------------------------------ the server picks gold; the page sees tokens only
    def test_the_server_always_picks_the_gold_never_own_footage_and_shows_only_tokens(self):
        self.items(gold=10, plain=0)
        self.items(gold=0, plain=60, source="own_app", owner=RYAN)
        self.items(gold=0, plain=60)
        self.small()
        self.ready(RYAN)
        cur = self.db.as_(RYAN).c.execute(START)
        cols = [c.name for c in cur.description]
        rows = cur.fetchall()
        self.assertFalse({"is_gold", "gold_answer", "source_kind", "item_id"} & set(cols), cols)
        kinds = [self.token_item(r[1]) for r in rows]
        self.assertEqual(sum(1 for k in kinds if k[1]), 2, "exactly gold_per_round, chosen by the server")
        self.assertTrue(all(k[2] != "own_app" for k in kinds if k[1]), "a gold is never own footage")
        with self.assertRaises(psycopg.Error):                                 # the answer table never shows an item id
            self.db.as_(RYAN).c.execute("select item_id from public.calibrate_answers")
        with self.assertRaises(psycopg.Error):                                 # own footage cannot carry a label, a time or a gold flag
            self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, owner_id, media_ref, choices, prompt) "
                             "values ('is_phrase', 'own_app', %s, 'loc_aaaaaaaaaaaaaaaa', '{a,b}', '{\"label\": \"holiday.mp4\", \"start\": 3.5}')", (RYAN,))
        with self.assertRaises(psycopg.Error):
            self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, owner_id, media_ref, choices) "
                             "values ('is_phrase', 'own_app', %s, 'C:/Users/someone/holiday.mp4', '{a,b}')", (RYAN,))
        self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, owner_id, media_ref, choices) "
                         "values ('is_phrase', 'own_app', %s, 'loc_aaaaaaaaaaaaaaaa', '{a,b}')", (RYAN,))   # the opaque reference alone: fine

    def test_another_persons_own_footage_is_never_served_and_a_token_from_another_round_is_refused(self):
        self.items(gold=10, plain=0)
        self.items(gold=0, plain=30, source="own_app", owner=OTHER)
        self.items(gold=0, plain=30)
        self.small()
        self.ready(RYAN)
        rid, tokens = self.start(RYAN)
        self.assertTrue(all(self.token_item(t)[2] != "own_app" for t in tokens))
        self.ready(OTHER)
        orid, otokens = self.start(OTHER)
        self.refused(RYAN, ANSWER, rid, otokens[0], "a", code="PT404")

    # ------------------------------------------------------------------------------------------ gold
    def test_18_earlier_golds_right_then_skipping_this_rounds_two_earns_nothing(self):
        self.items()
        self.small()
        self.ready(RYAN)
        for _ in range(9):                                                     # 18 golds, all right
            self.assertEqual(self.play(RYAN)[1]["result"], "held")
        rid, out = self.play(RYAN, gold="skip")                                # window: 18 of 20 = 90 percent, but this round 0 of 2
        self.assertEqual(out["result"], "gold_too_low")
        self.assertEqual(out["tenths"], 0)
        self.assertIsNone(self.d().execute("select id from public.calibrate_awards where round_id = %s", (rid,)).fetchone())
        self.assertEqual(self.play(RYAN)[1]["result"], "held")                 # the next careful round: paid again

    def test_the_20_answer_window_spans_rounds(self):
        self.items(gold=60)
        self.small()
        self.ready(RYAN)
        for _ in range(2):
            self.assertEqual(self.play(RYAN, gold="wrong")[1]["result"], "gold_too_low")      # 4 wrong
        for n in range(7):                                                     # all right in-round, but the window is under 80 percent
            self.assertEqual(self.play(RYAN)[1]["result"], "gold_too_low", n)  # after 7 more rounds: 14 of 18
        self.assertEqual(self.play(RYAN)[1]["result"], "held")                 # 16 of 20 = 80 percent: paid
        self.assertEqual(self.play(RYAN)[1]["result"], "held")                 # round 1's two wrong drop out of the window

    def test_an_expired_round_is_refused_at_finish_and_its_golds_count_as_wrong(self):
        self.items()
        self.small()
        self.ready(RYAN)
        rid, tokens = self.start(RYAN)
        self.answer_all(RYAN, rid, tokens)
        self.d().execute("update public.calibrate_rounds set expires_at = now() - interval '1 second' where id = %s", (rid,))
        self.refused(RYAN, FINISH, rid, code="22023", hint="calibrate_expired")
        self.assertIsNone(self.d().execute("select id from public.calibrate_awards where round_id = %s", (rid,)).fetchone())

    # ------------------------------------------------------------------------------------------ what a round pays, and what it says
    def test_finish_says_only_the_round_total_and_own_footage_earns_nothing(self):
        self.items(gold=10, plain=0)
        self.items(gold=0, plain=4, source="own_app", owner=RYAN)
        self.small(round_tenths=6)
        self.ready(RYAN)
        rid, out = self.play(RYAN)
        self.assertEqual(set(out), {"result", "tenths", "release_at"}, "never an accepted count, never which items were gold")
        self.assertEqual(out["tenths"], 2, "6 tenths x (2 paid golds of 6 items): the 4 own-footage answers earn nothing")
        cols = [c.name for c in self.db.as_(RYAN).c.execute("select * from public.calibrate_rounds limit 0").description]
        self.assertNotIn("accepted", cols)

    def test_three_too_fast_answers_pay_nothing_two_do_not_matter(self):
        self.items(kind="pick_cut")                                            # pick_cut: 4.0 seconds
        self.small()
        self.ready(RYAN)
        self.assertEqual(self.play(RYAN, pace_s=3)[1]["result"], "too_fast")
        self.assertEqual(self.play(RYAN, pace_s=5)[1]["result"], "held")

    # ------------------------------------------------------------------------------------------ caps, hold, budget, undo
    def test_the_daily_cap_is_rolling_24_hours_not_a_utc_day(self):
        self.items()
        self.small(round_tenths=30, daily_cap_tenths=30)
        self.ready(RYAN)
        rid, out = self.play(RYAN)
        self.assertEqual(out["tenths"], 30)
        self.assertEqual(self.play(RYAN)[1]["result"], "cap_reached")
        # yesterday 23:59 UTC: another calendar day, still inside 24 hours
        self.replica("update public.calibrate_awards set created_at = (date_trunc('day', now() at time zone 'utc') - interval '1 minute') at time zone 'utc' where round_id = %s", rid)
        self.assertEqual(self.play(RYAN)[1]["result"], "cap_reached")
        self.replica("update public.calibrate_awards set created_at = now() - interval '24 hours 1 minute' where round_id = %s", rid)
        self.assertEqual(self.play(RYAN)[1]["tenths"], 30)

    def test_an_undone_award_still_counts_toward_the_caps(self):
        self.items()
        self.small(round_tenths=30, daily_cap_tenths=30)
        self.ready(RYAN)
        rid, _ = self.play(RYAN)
        self.d().execute(UNDO, (self.award_of(rid), "test: answers not the person's"))
        self.assertEqual(self.play(RYAN)[1]["result"], "cap_reached")
        self.rules(daily_cap_tenths=1000, weekly_cap_tenths=30)
        self.assertEqual(self.play(RYAN)[1]["result"], "cap_reached", "the weekly cap counts it too")

    def test_every_award_waits_24_hours_then_lands_whole_through_grant_credits(self):
        self.items()
        self.small()
        self.rules(hold_hours=24)
        self.ready(RYAN)
        rids = [self.play(RYAN)[0] for _ in range(2)]                          # 2 x 5 tenths = 1 credit
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 0, "nothing lands before the hold ends")
        self.replica("update public.calibrate_awards set release_at = now() - interval '1 second' where round_id = %s", rids[0])
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 0, "5 tenths are not a whole credit")
        self.replica("update public.calibrate_awards set release_at = now() - interval '1 second' where round_id = %s", rids[1])
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 1)
        self.assertEqual(self.d().execute("select count(*) from public.credit_ledger where owner_id = %s and entry = 'grant' and created_by like 'calibrate:%%'", (RYAN,)).fetchone()[0], 1)

    def test_the_global_weekly_budget_holds_across_accounts(self):
        self.items(gold=80)
        self.small(round_tenths=10)
        self.rules(weekly_budget_credits=1)
        self.ready(RYAN)
        self.ready(OTHER)
        self.play(RYAN)
        orid, _ = self.play(OTHER)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN) + self.granted(OTHER), 1, "one credit a week for everyone together")
        self.assertEqual(self.d().execute("select count(*) from public.calibrate_releases").fetchone()[0], 1)
        self.rules(weekly_budget_credits=2)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN) + self.granted(OTHER), 2, "the held award lands when there is room")
        with self.assertRaises(psycopg.Error):
            self.rules(weekly_budget_credits=201)

    def test_the_award_ledger_is_append_only_and_the_undo_is_a_reversal_row(self):
        self.items()
        self.small(round_tenths=10)
        self.ready(RYAN)
        rid, _ = self.play(RYAN)
        self.d().execute(TICK)
        aid = self.award_of(rid)
        for sql in ("update public.calibrate_awards set tenths = 50", "delete from public.calibrate_awards"):
            with self.assertRaises(psycopg.Error):
                self.d().execute(sql)
        out = self.d().execute(UNDO, (aid, "test: answers not the person's")).fetchone()[0]
        self.assertEqual(out["credits_taken_back"], 1)
        self.assertEqual(self.d().execute("select sum(tenths) from public.calibrate_awards where round_id = %s", (rid,)).fetchone()[0], 0)
        with self.assertRaises(psycopg.Error):
            self.d().execute(UNDO, (aid, "again"))
        for who in (RYAN, "service"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute(UNDO, (aid, "not mine to undo"))

    def test_the_undo_takes_at_most_calibrates_own_credits_never_below_zero(self):
        self.items()
        self.small(round_tenths=10)
        self.ready(RYAN)
        self.d().execute("select public.grant_credits(%s, 'grant', 16, 'welcome (test)', 'welcome')", (RYAN,))
        rid, _ = self.play(RYAN)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 17)
        self.d().execute("select public.adjust_credits(%s, 'granted', -17, 'spent on films (test)', 'test')", (RYAN,))
        out = self.d().execute(UNDO, (self.award_of(rid), "test: undo after spending")).fetchone()[0]
        self.assertEqual(out["credits_taken_back"], 0)
        self.assertEqual(out["debt_tenths"], 10, "what could not be taken back is a calibrate debt")
        self.assertEqual(self.granted(RYAN), 0)
        rid2, _ = self.play(RYAN)                                              # the next release pays the debt first
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 0)

    def test_the_status_read_counts_undone_awards_and_returns_only_its_closed_keys(self):
        src = MIG.read_text(encoding="utf-8")
        body = src[src.index("create function public.connect_calibration_status"):src.index("-- ---", src.index("create function public.connect_calibration_status"))]
        for word in ("calibrate_items", "calibrate_round_items", "calibrate_answers", "gold", "grant_credits", "adjust_credits"):
            self.assertNotIn(word, body, word)
        keys = set(re.findall(r"'([a-z_]+)', ", body.split("jsonb_build_object(", 1)[1]))
        self.assertEqual(keys, {"schema", "open", "eligible", "consent_given", "tasks_per_round", "daily_cap_tenths", "counted_today_tenths",
                                "remaining_today_tenths", "held_tenths", "credits_kept_total", "page_path"})

    # ------------------------------------------------------------------------------------------ files
    def test_the_migration_ends_with_gate_apply_and_every_person_call_is_gated(self):
        self.assertTrue(MIG.read_text(encoding="utf-8").rstrip().endswith("select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)\n\ncommit;"))
        self.assertIn("select ryagram_private.gate_apply();", RB.read_text(encoding="utf-8"))
        rows = self.d().execute("select p.proname, p.prosrc like '%%perform ryagram_private.require_active();%%', p.proconfig::text "
                                "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'calibrate%%'").fetchall()
        self.assertEqual(len(rows), 5)
        for name, gated, cfg in rows:
            self.assertTrue(gated, name)
            self.assertIn('search_path=""', cfg, name)

    def test_the_rollback_refuses_while_an_award_is_held_then_leaves_no_table_and_keeps_the_credits(self):
        self.items()
        self.small(round_tenths=10)
        self.rules(hold_hours=24)
        self.ready(RYAN)
        rid, _ = self.play(RYAN)
        with self.assertRaises(psycopg.Error) as cm:
            self.d().execute(RB.read_text(encoding="utf-8"))
        self.assertIn("still held", cm.exception.diag.message_primary)
        self.d().execute("rollback")
        self.assertIsNotNone(self.d().execute("select to_regclass('public.calibrate_awards')").fetchone()[0], "nothing was dropped")
        self.replica("update public.calibrate_awards set release_at = now() - interval '1 second' where round_id = %s", rid)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 1)
        self.d().execute(RB.read_text(encoding="utf-8"))
        for t in TABLES:
            self.assertIsNone(self.d().execute("select to_regclass(%s)", (t,)).fetchone()[0], t)
        self.assertEqual(self.d().execute("select count(*) from pg_proc where proname like 'calibrate%%' or proname = 'connect_calibration_status'").fetchone()[0], 0)
        self.assertEqual(self.granted(RYAN), 1, "the ledger is append-only: granted credits stay")
        self.d().execute(MIG.read_text(encoding="utf-8"))                     # and it applies again
        self.assertIsNotNone(self.d().execute("select to_regclass('public.calibrate_awards')").fetchone()[0])

    def test_live_step_84_is_one_read_only_statement_and_answers_as_its_header_says(self):
        text = STEP.read_text(encoding="utf-8")
        self.assertEqual(len(statements(text)), 1)
        self.assertNotIn("@", text)
        for lit in re.findall(r"'(?:[^']|'')*'", text):
            self.assertNotIn(";", lit, lit)
        rows = self.d().execute(text).fetchall()
        self.assertEqual(len(rows), 9)
        self.assertTrue(all(ok for _, ok in rows), [r for r in rows if not r[1]])
        self.d().execute(RB.read_text(encoding="utf-8"))
        rows = self.d().execute(text).fetchall()
        self.assertEqual([ok for _, ok in rows], [True, False, False, False, False, False, False, False, True], rows)
        self.assertIn("none (not applied)", rows[8][0])


if __name__ == "__main__":
    unittest.main()
