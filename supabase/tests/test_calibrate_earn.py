"""CALIBRATE EARN RULES, revision 3 (migrations/20261127001100_calibrate_earn.sql, NOT APPLIED) on a local Postgres with the 2B credits ledger. BUILDER, 2026-11-27.
Plan: proposals/BUILDER-CALIBRATE-EARN-RULES-1127.md. DESIGN STAGE: written and py_compiled, NOT RUN yet (no Postgres in the design window).
Same setup as test_2b_credits.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    D:/Ryagram-scratch/WEB/pgvenv2/Scripts/python -B -m unittest supabase/tests/test_calibrate_earn.py -v

Revision 3 follows RENDERER's 12:43 review and WEB's page contract (web-calibrate2-1127 aee1ec4f, docs/calibrate-contract-needs-1127.md):
  1 one contract: the page's six my_calibration_* calls with its argument names and jsonb shapes; the page's four task types; CONNECT's status keys.
  2 ring leak: two accounts never see the same token, media reference or per-item words for the same known-answer item; the option order is shuffled per round.
  3 withdrawn consent cancels every held award (at withdrawal and again at release); never paid.
  4 the last answer says only round_done (round_result null); nothing readable tells the outcome before the hold is over.
  5 the weekly budget is reserved when a round starts (no room: budget_used, no round, no award); a lifetime cap; the master switch stops rounds and releases at once.
  6 item-token expiry and re-issue; a repeat close returns the same; three failed rounds in 7 days pause the account; a new words version needs a new yes; only cleared items are served.
Must-fail style: every refusal sits beside the case that works, so a test cannot pass because nothing works.
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
MIG = core.ROOT / "migrations" / "20261127001100_calibrate_earn.sql"
RB = core.ROOT / "rollbacks" / "20261127001100_calibrate_earn_rollback.sql"
STEP = core.ROOT / "live-steps" / "84_calibrate_check.sql"
WORDS_ID = "calibrate-consent-1"
CONSENT_GET = "select public.my_calibration_consent_get()"
CONSENT = "select public.my_calibration_consent_set(%s, %s)"
ROUND = "select public.my_calibration_round_get()"
ANSWER = "select public.my_calibration_answer_set(%s, %s, %s)"
EARNED = "select public.my_calibration_earned_get()"
UNDO_ME = "select public.my_calibration_undo(%s::uuid)"
CLOSE = "select ryagram_private.calibrate_round_close(%s::uuid, false)"
UNDO = "select ryagram_private.calibrate_award_undo(%s, %s)"
TICK = "select ryagram_private.calibrate_release_due()"
PAGE_CALLS = {"my_calibration_consent_get()": "", "my_calibration_consent_set(boolean,text)": "p_on, p_words_id", "my_calibration_round_get()": "",
              "my_calibration_answer_set(text,text,text)": "p_round, p_item, p_answer", "my_calibration_earned_get()": "", "my_calibration_undo(uuid)": "p_ledger"}
TYPES = {"better_cut", "confirm_speaker", "is_phrase", "rate_match"}                  # the page's TYPES, exactly
TABLES = ("public.calibrate_consents", "public.calibrate_rounds", "public.calibrate_answers", "public.calibrate_awards", "public.calibrate_releases",
          "public.calibrate_credit_moves", "ryagram_private.calibrate_items", "ryagram_private.calibrate_round_items", "ryagram_private.calibrate_media_handles",
          "ryagram_private.calibrate_points", "ryagram_private.calibrate_budget", "ryagram_private.calibrate_task_kinds", "ryagram_private.calibrate_consent_words",
          "ryagram_private.calibrate_rules")
SMALL = dict(round_size=6, gold_per_round=2, gold_round_min=2, rounds_per_day=60, daily_cap_tenths=1000, weekly_cap_tenths=5000, lifetime_cap_tenths=100000,
             hold_hours=0, weekly_budget_credits=200)
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


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

    def master(self, on=True):
        self.d().execute("update public.ops_settings set calibrate_enabled = %s", (on,))

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
        self.master()
        self.switch(who)
        self.age(who, 8)
        self.film(who)
        out = self.one(who, CONSENT, True, WORDS_ID)
        self.assertTrue(out["consented"])

    def items(self, gold=40, plain=200, source="public_domain", owner=None, kind="is_phrase", status="cleared"):
        note = None if source == "own_app" else "test clip, public domain"
        for g in range(gold):
            self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, licence_note, status, media_ref, choices, is_gold, gold_answer) "
                             "values ('is_phrase', 'public_domain', 'test clip, public domain', %s, %s, '{yes,no}', true, 'yes')", (status, f"pack-{g}"))
        for p in range(plain):
            ref = f"loc_{p:020d}" if source == "own_app" else f"site-{source}-{p}"
            self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, owner_id, licence_note, status, media_ref, choices) "
                             "values (%s, %s, %s, %s, %s, %s, '{yes,no}')", (kind, source, owner, note, status, ref))

    def token_item(self, token):
        """(item id, is_gold, source_kind, served order, gold answer) for a served token: the test reads the closed tables as the dashboard."""
        return self.d().execute("select i.id, i.is_gold, i.source_kind, x.choice_order, i.gold_answer from ryagram_private.calibrate_round_items x "
                                "join ryagram_private.calibrate_items i on i.id = x.item_id where x.item_token = %s::uuid", (token,)).fetchone()

    def letter(self, task, gold):
        _, is_gold, _, order, ans = self.token_item(task["token"])
        if not is_gold:
            return "a"
        if gold == "skip":
            return "skip"
        want = ans if gold == "right" else next(c for c in order if c != ans)
        return chr(97 + order.index(want))

    def start(self, who=RYAN):
        try:
            out = self.one(who, ROUND)
        except psycopg.Error as e:
            self.fail(f"a round that was meant to start was refused: {e.sqlstate} {e.diag.message_primary}")
        self.assertEqual(out["state"], "ready", out)
        return out["round"]["token"], out["round"]["tasks"]

    def answer_all(self, who, rid, tasks, gold="right", pace_s=7):
        """gold: 'right', 'wrong' or 'skip'. All but the last answer, then the dashboard spreads them pace_s seconds apart on the server's clock, then the last one (which closes)."""
        for t in tasks[:-1]:
            self.one(who, ANSWER, rid, t["token"], self.letter(t, gold))
        n = len(tasks)
        self.d().execute("update public.calibrate_rounds set started_at = now() - make_interval(secs => %s) where id = %s::uuid", (pace_s * n, rid))
        self.d().execute("update public.calibrate_answers a set answered_at = now() - make_interval(secs => %s * (%s - k.k)) "
                         "from (select id, row_number() over (order by id) as k from public.calibrate_answers where round_id = %s::uuid) k where a.id = k.id",
                         (pace_s, n, rid))
        return self.one(who, ANSWER, rid, tasks[-1]["token"], self.letter(tasks[-1], gold))

    def play(self, who=RYAN, gold="right", pace_s=7):
        rid, tasks = self.start(who)
        last = self.answer_all(who, rid, tasks, gold, pace_s)
        self.assertTrue(last["round_done"])
        return rid, last

    def result(self, rid):
        return self.d().execute("select result, tenths from public.calibrate_rounds where id = %s::uuid", (rid,)).fetchone()

    def refused(self, who, sql, *args, code="42501", word=None):
        with self.assertRaises(psycopg.Error, msg=(who, sql, args)) as cm:
            self.db.as_(who).c.execute(sql, args or None)
        self.assertEqual(cm.exception.sqlstate, code, (who, sql, args, cm.exception))
        if word:
            self.assertTrue(cm.exception.diag.message_primary.startswith(word + ":"), cm.exception.diag.message_primary)
        return cm.exception.diag.message_primary

    def award_of(self, rid):
        row = self.d().execute("select id from public.calibrate_awards where round_id = %s::uuid and kind = 'award'", (rid,)).fetchone()
        return row and row[0]

    def due(self, rid):
        self.replica("update public.calibrate_awards set release_at = now() - interval '1 second' where round_id = %s::uuid and kind = 'award'", rid)

    # ------------------------------------------------------------------------------------------ 1 one contract
    def test_1_the_page_calls_exist_with_the_page_argument_names_and_jsonb_shapes(self):
        for sig, args in PAGE_CALLS.items():
            row = self.d().execute("select pg_get_function_identity_arguments(p.oid), p.prorettype::regtype::text from pg_proc p where p.oid = to_regprocedure(%s)",
                                   ("public." + sig,)).fetchone()
            self.assertIsNotNone(row, sig)
            self.assertEqual(re.sub(r" (boolean|text|uuid)", "", row[0]), args, sig)
            self.assertEqual(row[1], "jsonb", sig)
        self.assertEqual(self.d().execute("select count(*) from pg_proc where proname in ('calibrate_consent_set', 'calibrate_round_start', 'calibrate_round_items', "
                                          "'calibrate_answer', 'calibrate_round_finish')").fetchone()[0], 0, "the old names are gone: one contract")
        self.assertEqual({r[0] for r in self.d().execute("select kind from ryagram_private.calibrate_task_kinds")}, TYPES)
        self.items(gold=10, plain=40)
        self.small()
        self.ready(RYAN)
        c = self.one(RYAN, CONSENT_GET)
        self.assertEqual(set(c), {"consented", "at", "words_id", "withdraw_note", "gate"})
        self.assertEqual((c["consented"], c["words_id"], c["gate"]), (True, WORDS_ID, None))
        r = self.one(RYAN, ROUND)
        self.assertEqual(set(r), {"state", "round", "gate", "cap"})
        self.assertEqual(set(r["cap"]), {"reached", "period"})
        self.assertEqual(set(r["round"]), {"token", "total", "answered", "tasks"})
        self.assertEqual((r["round"]["total"], r["round"]["answered"], len(r["round"]["tasks"])), (6, 0, 6))
        for t in r["round"]["tasks"]:
            self.assertEqual(set(t), {"token", "type", "prompt", "clip", "options"})
            self.assertIn(t["type"], TYPES)
            self.assertRegex(t["token"], UUID_RE)
            self.assertEqual(t["clip"]["kind"], "licensed")
            self.assertTrue(t["clip"]["url"].startswith("https://"))
            for o in t["options"]:
                self.assertEqual(set(o), {"id", "label", "clip"})
                self.assertNotEqual(o["id"], "skip")
                self.assertTrue(o["label"])
        a = self.one(RYAN, ANSWER, r["round"]["token"], r["round"]["tasks"][0]["token"], "skip")
        self.assertEqual(set(a), {"ok", "answered", "total", "cap_reached", "cap_period", "round_done", "round_result"})
        self.assertEqual((a["ok"], a["answered"], a["total"], a["round_done"]), (True, 1, 6, False))
        e = self.one(RYAN, EARNED)
        self.assertEqual(set(e), {"round", "today", "week", "total", "pending", "ledger"})
        # the error words the page matches on
        self.refused(RYAN, ANSWER, r["round"]["token"], r["round"]["tasks"][0]["token"], "a", code="22023", word="item_used")
        self.refused(RYAN, ANSWER, r["round"]["token"], "not-a-token", "a", code="PT404", word="task_unknown")
        self.refused(RYAN, ANSWER, r["round"]["token"], r["round"]["tasks"][1]["token"], "z", code="22023", word="task_unknown")
        self.switch(RYAN, on=False)
        self.refused(RYAN, ROUND, word="not_on")

    def test_1_switches_consent_and_the_gate_are_states_or_not_on_beside_the_case_that_works(self):
        self.items()
        self.small()
        self.master()
        self.age(RYAN, 8)
        self.film(RYAN)
        self.refused(RYAN, CONSENT_GET, word="not_on")
        self.switch(OTHER)                                                     # someone else's switch opens nothing for me
        self.refused(RYAN, ROUND, word="not_on")
        self.switch(RYAN)
        self.assertEqual(self.one(RYAN, ROUND)["state"], "not_consented")
        self.refused(RYAN, CONSENT, True, "calibrate-consent-9", code="22023", word="words_unknown")
        self.one(RYAN, CONSENT, True, WORDS_ID)
        self.age(RYAN, 2)
        r = self.one(RYAN, ROUND)
        self.assertEqual((r["state"], r["gate"]), ("gate", {"days_needed": 5, "needs_film": False}))
        self.age(RYAN, 8)
        self.start(RYAN)
        self.switch(WORKER)
        self.age(WORKER, 30)
        self.refused(WORKER, CONSENT, True, WORDS_ID, word="not_on")
        for who in ("anon", "service"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute(ROUND)

    def test_1_a_connected_ai_token_is_refused_and_the_connector_login_runs_only_the_status_read(self):
        self.items()
        self.small()
        self.ready(RYAN)
        rid, tasks = self.start(RYAN)
        for sql, args in ((CONSENT, (True, WORDS_ID)), (ANSWER, (rid, tasks[0]["token"], "a")), (ROUND, ()), (EARNED, ()), (CONSENT_GET, ())):
            d = self.db.as_(RYAN)
            d.c.execute("select set_config('request.jwt.claims', %s, false)", ('{"sub": "%s", "role": "authenticated", "client_id": "x"}' % RYAN,))
            with self.assertRaises(psycopg.Error, msg=sql) as cm:
                d.c.execute(sql, args or None)
            self.assertEqual(cm.exception.sqlstate, "42501")
            d.c.execute("select set_config('request.jwt.claims', '', false)")
        self.assertEqual(self.d().execute("select count(*) from public.calibrate_answers").fetchone()[0], 0)
        self.one(RYAN, ANSWER, rid, tasks[0]["token"], "a")                    # the same person in the app: works
        if self.d().execute("select exists (select 1 from pg_roles where rolname = 'connect_runner')").fetchone()[0]:
            for sig in PAGE_CALLS:
                self.assertFalse(self.d().execute("select has_function_privilege('connect_runner', %s::regprocedure, 'execute')", ("public." + sig,)).fetchone()[0], sig)
            self.assertTrue(self.d().execute("select has_function_privilege('connect_runner', 'public.connect_calibration_status(text)'::regprocedure, 'execute')").fetchone()[0])

    def test_1_the_status_read_has_connects_keys_exactly_and_reads_no_award_or_item(self):
        src = MIG.read_text(encoding="utf-8")
        body = src[src.index("create function public.connect_calibration_status"):src.index("-- ---", src.index("create function public.connect_calibration_status"))]
        for word in ("calibrate_items", "calibrate_round_items", "calibrate_answers", "calibrate_awards", "gold", "grant_credits", "adjust_credits"):
            self.assertNotIn(word, body, word)
        keys = set(re.findall(r"'([a-z_]+)', ", body.split("jsonb_build_object(", 1)[1]))
        self.assertEqual(keys, {"schema", "open", "eligible", "consent_given", "tasks_per_round", "daily_cap", "earned_today", "remaining_today", "earned_total", "page_path"})
        self.assertIn("'ryagram.calibration-status/0'", body)

    # ------------------------------------------------------------------------------------------ 2 ring leak
    def test_2_two_accounts_never_see_the_same_reference_for_the_same_gold_item_and_the_order_is_shuffled(self):
        self.items(gold=2, plain=0)                                            # exactly two golds: both accounts are served both
        self.items(gold=0, plain=60)
        self.small()
        self.ready(RYAN)
        self.ready(OTHER)
        seen = {}
        for who in (RYAN, OTHER):
            rid, tasks = self.start(who)
            for t in tasks:
                iid, is_gold, _, order, ans = self.token_item(t["token"])
                if is_gold:
                    seen.setdefault(iid, []).append((t, order))
        self.assertEqual(len(seen), 2)
        refs = {r[0] for r in self.d().execute("select media_ref from ryagram_private.calibrate_items")}
        kind_prompts = {r[0] for r in self.d().execute("select prompt from ryagram_private.calibrate_task_kinds")}
        for iid, both in seen.items():
            self.assertEqual(len(both), 2, "served to both accounts")
            (t1, _), (t2, _) = both
            self.assertNotEqual(t1["token"], t2["token"])
            self.assertNotEqual(t1["clip"]["url"], t2["clip"]["url"], "a per-round handle, never a shared reference")
            self.assertIsNone(t1["clip"]["label"])
            for t in (t1, t2):
                self.assertIn(t["prompt"], kind_prompts, "the kind's words only, never the item's")
                self.assertFalse(any(ref in t["clip"]["url"] for ref in refs), "the item's media_ref never leaves the server")
        # shuffled per account per round: over many rounds the gold answer does not always sit on the same letter
        self.d().execute("delete from public.calibrate_answers")
        self.d().execute("delete from public.calibrate_rounds")
        self.items(gold=40, plain=0)
        places = set()
        for _ in range(6):
            for who in (RYAN, OTHER):
                rid, tasks = self.start(who)
                for t in tasks:
                    _, is_gold, _, order, ans = self.token_item(t["token"])
                    if is_gold:
                        places.add(order.index(ans))
                self.answer_all(who, rid, tasks)
        self.assertEqual(places, {0, 1}, "the right answer moves between a and b")

    def test_2_a_letter_maps_to_this_rounds_order_and_the_canonical_answer_is_stored(self):
        self.items(gold=10, plain=40)
        self.small()
        self.ready(RYAN)
        rid, tasks = self.start(RYAN)
        t = tasks[0]
        _, _, _, order, _ = self.token_item(t["token"])
        self.one(RYAN, ANSWER, rid, t["token"], "b")
        self.assertEqual(self.d().execute("select answer from public.calibrate_answers where round_id = %s::uuid", (rid,)).fetchone()[0], order[1])

    # ------------------------------------------------------------------------------------------ 3 withdrawal
    def test_3_withdrawing_cancels_every_held_award_with_a_reason_and_it_is_never_paid(self):
        self.items()
        self.small(round_tenths=10, hold_hours=24)
        self.ready(RYAN)
        rid, _ = self.play(RYAN)
        self.assertEqual(self.result(rid)[0], "held")
        out = self.one(RYAN, CONSENT, False, None)
        self.assertEqual(out["consented"], False)
        self.assertTrue(out["note"])
        note = self.d().execute("select note from public.calibrate_awards where round_id = %s::uuid and kind = 'reversal'", (rid,)).fetchone()
        self.assertIsNotNone(note, "cancelled at once")
        self.assertIn("consent withdrawn", note[0])
        self.due(rid)
        self.one(RYAN, CONSENT, True, WORDS_ID)                                # saying yes again does not revive it
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 0)

    def test_3_release_time_rechecks_consent_withdrawn_behind_the_calls_back(self):
        self.items()
        self.small(round_tenths=10, hold_hours=24)
        self.ready(RYAN)
        self.ready(OTHER)
        rid, _ = self.play(RYAN)
        orid, _ = self.play(OTHER)
        self.d().execute("update public.calibrate_consents set withdrawn_at = now() where owner_id = %s", (RYAN,))   # a withdrawal that skipped the cancel
        self.due(rid)
        self.due(orid)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 0, "withdrawn at release time: cancelled")
        self.assertIsNotNone(self.d().execute("select 1 from public.calibrate_awards where round_id = %s::uuid and kind = 'reversal'", (rid,)).fetchone())
        self.assertEqual(self.granted(OTHER), 1, "the other person, still in: paid")

    def test_3_withdrawing_works_with_the_switches_off(self):
        self.items()
        self.small()
        self.ready(RYAN)
        self.master(False)
        self.switch(RYAN, on=False)
        self.assertFalse(self.one(RYAN, CONSENT, False, None)["consented"])
        self.assertIsNotNone(self.d().execute("select withdrawn_at from public.calibrate_consents where owner_id = %s", (RYAN,)).fetchone()[0])

    # ------------------------------------------------------------------------------------------ 4 finish tells nothing
    def test_4_the_last_answer_and_every_read_say_nothing_about_the_checks_until_the_hold_is_over(self):
        self.items()
        self.small(round_tenths=10, hold_hours=24, gold_min_pct=50)      # 2 of 4 over the window: the good round can still be released
        self.ready(RYAN)
        rid_ok, good = self.play(RYAN)
        rid_bad, bad = self.play(RYAN, gold="wrong")
        self.assertEqual((self.result(rid_ok)[0], self.result(rid_bad)[0]), ("held", "gold_too_low"))
        strip = lambda x: {k: v for k, v in x.items() if k != "answered"}
        self.assertEqual(strip(good), strip(bad), "a passed and a failed round end with the same words")
        self.assertIsNone(good["round_result"])
        e = self.one(RYAN, EARNED)
        self.assertEqual((e["round"], e["pending"], e["ledger"]), (None, None, []), "nothing shows while the hold runs")
        for t in ("public.calibrate_rounds", "public.calibrate_awards", "public.calibrate_releases", "public.calibrate_credit_moves"):
            with self.assertRaises(psycopg.Error, msg=t):
                self.db.as_(RYAN).c.execute(f"select * from {t}")
        self.replica("update public.calibrate_rounds set finished_at = now() - interval '25 hours' where id in (%s::uuid, %s::uuid)", rid_ok, rid_bad)
        self.due(rid_ok)
        self.d().execute(TICK)
        e = self.one(RYAN, EARNED)
        rows = {r["id"]: r for r in e["ledger"]}
        self.assertEqual((rows[rid_ok]["credits"], rows[rid_bad]["credits"]), (1, 0), "later: paid, or 0, never why")
        self.assertEqual(set(rows[rid_bad]), {"id", "at", "task_type", "credits", "undone"})

    def test_4_a_repeat_close_returns_the_same_and_a_closed_round_takes_no_answer(self):
        self.items()
        self.small()
        self.ready(RYAN)
        rid, tasks = self.start(RYAN)
        for t in tasks[:-1]:
            self.one(RYAN, ANSWER, rid, t["token"], "a")
        last = self.one(RYAN, ANSWER, rid, tasks[-1]["token"], "a")
        self.assertTrue(last["round_done"])
        before = self.result(rid)
        awards = self.d().execute("select count(*) from public.calibrate_awards where round_id = %s::uuid", (rid,)).fetchone()[0]
        self.assertEqual(self.d().execute(CLOSE, (rid,)).fetchone()[0], {"done": True})
        self.assertEqual(self.d().execute(CLOSE, (rid,)).fetchone()[0], {"done": True})
        self.assertEqual(self.result(rid), before, "scored once")
        self.assertEqual(self.d().execute("select count(*) from public.calibrate_awards where round_id = %s::uuid", (rid,)).fetchone()[0], awards, "no second award")
        self.refused(RYAN, ANSWER, rid, tasks[-1]["token"], "a", code="22023", word="round_ended")

    # ------------------------------------------------------------------------------------------ 5 budget, lifetime cap, master switch
    def test_5_budget_out_means_no_round_and_no_award_and_a_reservation_comes_back(self):
        self.items(gold=80)
        self.small(round_tenths=10)
        self.rules(weekly_budget_credits=0)
        self.ready(RYAN)
        self.ready(OTHER)
        self.assertEqual(self.one(RYAN, ROUND)["state"], "budget_used")
        self.assertEqual(self.d().execute("select count(*) from public.calibrate_rounds").fetchone()[0], 0)
        self.rules(weekly_budget_credits=1)
        rid, tasks = self.start(RYAN)                                          # reserves the whole credit
        self.assertEqual(self.one(OTHER, ROUND)["state"], "budget_used", "the reservation holds the budget")
        self.answer_all(RYAN, rid, tasks, gold="wrong")                        # pays nothing: the reservation goes back
        self.assertEqual(self.d().execute("select count(*) from public.calibrate_awards").fetchone()[0], 0)
        self.start(OTHER)
        with self.assertRaises(psycopg.Error):
            self.rules(weekly_budget_credits=201)

    def test_5_the_lifetime_cap_per_account(self):
        self.items()
        self.small(round_tenths=10, lifetime_cap_tenths=10)
        self.ready(RYAN)
        rid, _ = self.play(RYAN)
        self.assertEqual(self.result(rid), ("held", 10))
        r = self.one(RYAN, ROUND)
        self.assertEqual((r["state"], r["cap"]), ("cap_reached", {"reached": True, "period": None}))
        self.rules(lifetime_cap_tenths=20)
        self.start(RYAN)

    def test_5_the_master_switch_stops_new_rounds_answers_and_releases_at_once(self):
        self.items()
        self.small(round_tenths=10, hold_hours=24)
        self.ready(RYAN)
        rid, _ = self.play(RYAN)
        orid, tasks = self.start(RYAN)
        self.due(rid)
        self.master(False)
        self.refused(RYAN, ROUND, word="not_on")
        self.refused(RYAN, ANSWER, orid, tasks[0]["token"], "a", word="not_on")
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 0, "nothing released while it is off")
        self.assertIsNone(self.d().execute("select 1 from public.calibrate_awards where round_id = %s::uuid and kind = 'reversal'", (rid,)).fetchone(), "held, not cancelled")
        self.master(True)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 1)

    # ------------------------------------------------------------------------------------------ 6 token expiry, strikes, re-consent, cleared
    def test_6_an_item_token_expires_after_15_minutes_and_the_round_issues_a_new_one(self):
        self.items()
        self.small()
        self.ready(RYAN)
        self.assertEqual(self.d().execute("select token_minutes from ryagram_private.calibrate_rules").fetchone()[0], 15)
        rid, tasks = self.start(RYAN)
        old = tasks[0]["token"]
        self.d().execute("update ryagram_private.calibrate_round_items set token_expires_at = now() - interval '1 second' where item_token = %s::uuid", (old,))
        self.refused(RYAN, ANSWER, rid, old, "a", code="22023", word="round_ended")
        r = self.one(RYAN, ROUND)
        self.assertEqual(r["round"]["token"], rid, "the same round")
        tokens = [t["token"] for t in r["round"]["tasks"]]
        self.assertNotIn(old, tokens)
        self.assertEqual(len(tokens), 6)
        new = next(t for t in tokens if t not in {x["token"] for x in tasks})
        self.one(RYAN, ANSWER, rid, new, "a")
        self.refused(RYAN, ANSWER, rid, old, "a", code="PT404", word="task_unknown")

    def test_6_three_failed_rounds_in_7_days_pause_the_account_for_7_days(self):
        self.items(gold=60)
        self.small()
        self.ready(RYAN)
        for _ in range(2):
            self.play(RYAN, gold="wrong")
        self.start(RYAN)                                                       # two strikes: still open
        self.d().execute("update public.calibrate_rounds set expires_at = now() - interval '1 second' where finished_at is null")
        self.assertEqual(self.one(RYAN, ROUND)["state"], "ready", "an expired round is not a strike")
        rid, tasks = self.start(RYAN)
        self.answer_all(RYAN, rid, tasks, gold="wrong")
        self.assertEqual(self.one(RYAN, ROUND)["state"], "paused")
        self.replica("update public.calibrate_rounds set finished_at = finished_at - interval '7 days 1 minute' where result = 'gold_too_low'")
        self.assertEqual(self.one(RYAN, ROUND)["state"], "ready", "the pause ends")

    def test_6_a_new_words_version_needs_a_new_yes(self):
        self.items()
        self.small()
        self.ready(RYAN)
        self.start(RYAN)
        self.d().execute("update ryagram_private.calibrate_consent_words set is_current = false")
        self.d().execute("insert into ryagram_private.calibrate_consent_words (id, words, withdraw_note, is_current) values "
                         "('calibrate-consent-2', 'New words about how answers are used.', 'What happens if you stop, in new words.', true)")
        self.assertEqual(self.one(RYAN, ROUND)["state"], "not_consented")
        c = self.one(RYAN, CONSENT_GET)
        self.assertEqual((c["consented"], c["words_id"]), (False, "calibrate-consent-2"))
        self.refused(RYAN, CONSENT, True, WORDS_ID, code="22023", word="words_unknown")
        self.one(RYAN, CONSENT, True, "calibrate-consent-2")
        self.assertEqual(self.one(RYAN, ROUND)["state"], "ready")

    def test_6_only_cleared_items_are_served(self):
        self.items(status="pending")
        self.small()
        self.ready(RYAN)
        self.assertEqual(self.one(RYAN, ROUND)["state"], "none")
        self.d().execute("update ryagram_private.calibrate_items set status = 'cleared' where is_gold")
        self.assertEqual(self.one(RYAN, ROUND)["state"], "none", "the plain items are still pending")
        self.d().execute("update ryagram_private.calibrate_items set status = 'cleared'")
        rid, tasks = self.start(RYAN)
        self.d().execute("update ryagram_private.calibrate_items set status = 'withdrawn'")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.calibrate_round_items where round_id = %s::uuid", (rid,)).fetchone()[0], 6)

    # ------------------------------------------------------------------------------------------ the rules kept from revision 2
    def test_own_footage_carries_only_an_opaque_reference_and_is_served_only_to_its_owner(self):
        self.items(gold=10, plain=0)
        self.items(gold=0, plain=30, source="own_app", owner=OTHER)
        self.items(gold=0, plain=30)
        self.small()
        self.ready(RYAN)
        rid, tasks = self.start(RYAN)
        self.assertTrue(all(self.token_item(t["token"])[2] != "own_app" for t in tasks))
        self.ready(OTHER)
        orid, otasks = self.start(OTHER)
        self.refused(RYAN, ANSWER, rid, otasks[0]["token"], "a", code="PT404", word="task_unknown")
        for t in otasks:
            if self.token_item(t["token"])[2] == "own_app":
                self.assertEqual(t["clip"]["kind"], "own_app")
                self.assertRegex(t["clip"]["url"], r"^http://127\.0\.0\.1:\d+/calibrate/clip/[0-9a-f]{64}$")
        with self.assertRaises(psycopg.Error):
            self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, owner_id, media_ref, choices) "
                             "values ('is_phrase', 'own_app', %s, 'C:/Users/someone/holiday.mp4', '{yes,no}')", (RYAN,))
        with self.assertRaises(psycopg.Error):
            self.d().execute("insert into ryagram_private.calibrate_items (task_kind, source_kind, owner_id, media_ref, choices, is_gold, gold_answer) "
                             "values ('is_phrase', 'own_app', %s, 'loc_aaaaaaaaaaaaaaaa', '{yes,no}', true, 'yes')", (RYAN,))

    def test_18_earlier_golds_right_then_skipping_this_rounds_two_earns_nothing(self):
        self.items()
        self.small()
        self.ready(RYAN)
        for _ in range(9):
            self.assertEqual(self.result(self.play(RYAN)[0])[0], "held")
        rid, _ = self.play(RYAN, gold="skip")
        self.assertEqual(self.result(rid), ("gold_too_low", 0))
        self.assertIsNone(self.award_of(rid))

    def test_three_too_fast_answers_pay_nothing_two_do_not_matter(self):
        self.items(kind="confirm_speaker")                                     # 3.0 seconds
        self.small()
        self.ready(RYAN)
        self.assertEqual(self.result(self.play(RYAN, pace_s=2)[0])[0], "too_fast")
        self.assertEqual(self.result(self.play(RYAN, pace_s=4)[0])[0], "held")

    def test_the_daily_cap_counts_rounds_rolling_24_hours(self):
        self.items()
        self.small(round_tenths=30, daily_cap_tenths=30)
        self.ready(RYAN)
        rid, _ = self.play(RYAN, gold="wrong")                                 # a failed round counts too: the cap never tells
        r = self.one(RYAN, ROUND)
        self.assertEqual((r["state"], r["cap"]["period"]), ("cap_reached", "day"))
        self.d().execute("update public.calibrate_rounds set started_at = now() - interval '24 hours 1 minute' where id = %s::uuid", (rid,))
        self.start(RYAN)

    def test_every_award_waits_then_lands_whole_through_grant_credits(self):
        self.items()
        self.small(hold_hours=24)
        self.ready(RYAN)
        rids = [self.play(RYAN)[0] for _ in range(2)]                          # 2 x 5 tenths = 1 credit
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 0, "nothing lands before the hold ends")
        self.due(rids[0])
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 0, "5 tenths are not a whole credit")
        self.due(rids[1])
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 1)
        self.assertEqual(self.d().execute("select count(*) from public.credit_ledger where owner_id = %s and entry = 'grant' and created_by like 'calibrate:%%'", (RYAN,)).fetchone()[0], 1)

    def test_the_award_ledger_is_append_only_and_the_person_can_take_back_their_own(self):
        self.items()
        self.small(round_tenths=10)
        self.ready(RYAN)
        rid, _ = self.play(RYAN)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 1)
        for sql in ("update public.calibrate_awards set tenths = 50", "delete from public.calibrate_awards"):
            with self.assertRaises(psycopg.Error):
                self.d().execute(sql)
        self.ready(OTHER)
        self.refused(OTHER, UNDO_ME, rid, code="PT404", word="not_undoable")    # not theirs
        self.assertEqual(self.one(RYAN, UNDO_ME, rid), {"ok": True})
        self.assertEqual(self.granted(RYAN), 0)
        self.refused(RYAN, UNDO_ME, rid, code="PT404", word="not_undoable")     # once
        for who in (RYAN, "service"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute(UNDO, (self.award_of(rid), "not mine to undo"))

    def test_the_dashboard_undo_takes_at_most_calibrates_own_credits_never_below_zero(self):
        self.items()
        self.small(round_tenths=10)
        self.ready(RYAN)
        self.d().execute("select public.grant_credits(%s, 'grant', 16, 'welcome (test)', 'welcome')", (RYAN,))
        rid, _ = self.play(RYAN)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 17)
        self.d().execute("select public.adjust_credits(%s, 'granted', -17, 'spent on films (test)', 'test')", (RYAN,))
        out = self.d().execute(UNDO, (self.award_of(rid), "test: undo after spending")).fetchone()[0]
        self.assertEqual((out["credits_taken_back"], out["debt_tenths"]), (0, 10))
        self.assertEqual(self.granted(RYAN), 0)

    # ------------------------------------------------------------------------------------------ files
    def test_the_migration_ends_with_gate_apply_and_every_page_call_is_gated(self):
        text = MIG.read_text(encoding="utf-8")
        self.assertTrue(text.rstrip().endswith("select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)\n\ncommit;"))
        self.assertTrue(all(ord(ch) < 128 for ch in text), "plain ASCII")
        self.assertIn("select ryagram_private.gate_apply();", RB.read_text(encoding="utf-8"))
        rows = self.d().execute("select p.proname, p.prosrc like '%%perform ryagram_private.require_active();%%', p.proconfig "
                                "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'my_calibration%%'").fetchall()
        self.assertEqual(len(rows), 6)
        for name, gated, cfg in rows:
            self.assertTrue(gated, name)
            self.assertEqual(cfg, ['search_path=""'], name)                 # set search_path = '' is stored as the element search_path="" (proconfig::text escapes the quotes)

    def test_the_rollback_refuses_while_an_award_is_held_then_leaves_nothing_and_keeps_the_credits(self):
        self.items()
        self.small(round_tenths=10, hold_hours=24)
        self.ready(RYAN)
        rid, _ = self.play(RYAN)
        with self.assertRaises(psycopg.Error) as cm:
            self.d().execute(RB.read_text(encoding="utf-8"))
        self.assertIn("still held", cm.exception.diag.message_primary)
        self.db.c.execute("rollback")                                        # the failed file left its explicit transaction open: end it before as_() runs "reset role"
        self.assertIsNotNone(self.d().execute("select to_regclass('public.calibrate_awards')").fetchone()[0], "nothing was dropped")
        self.due(rid)
        self.d().execute(TICK)
        self.assertEqual(self.granted(RYAN), 1)
        self.d().execute(RB.read_text(encoding="utf-8"))
        for t in TABLES:
            self.assertIsNone(self.d().execute("select to_regclass(%s)", (t,)).fetchone()[0], t)
        self.assertEqual(self.d().execute("select count(*) from pg_proc where proname like 'calibrate%%' or proname like 'my_calibration%%' "
                                          "or proname = 'connect_calibration_status'").fetchone()[0], 0)
        self.assertIsNone(self.d().execute("select 1 from information_schema.columns where table_name = 'ops_settings' and column_name = 'calibrate_enabled'").fetchone())
        self.assertEqual(self.granted(RYAN), 1, "the ledger is append-only: granted credits stay")
        self.d().execute(MIG.read_text(encoding="utf-8"))                     # and it applies again
        self.assertIsNotNone(self.d().execute("select to_regclass('public.calibrate_awards')").fetchone()[0])

    def test_live_step_84_is_one_read_only_statement_and_answers_as_its_header_says(self):
        text = STEP.read_text(encoding="utf-8")
        self.assertEqual(len(statements(text)), 1)
        self.assertNotIn("@", text)
        self.assertTrue(all(ord(ch) < 128 for ch in text), "plain ASCII")
        for lit in re.findall(r"'(?:[^']|'')*'", text):
            self.assertNotIn(";", lit, lit)
        rows = self.d().execute(text).fetchall()
        self.assertEqual(len(rows), 10)
        self.assertTrue(all(ok for _, ok in rows), [r for r in rows if not r[1]])
        self.d().execute(RB.read_text(encoding="utf-8"))
        rows = self.d().execute(text).fetchall()
        self.assertEqual([ok for _, ok in rows], [True] + [False] * 8 + [True], rows)
        self.assertIn("none (not applied)", rows[9][0])


if __name__ == "__main__":
    unittest.main()
