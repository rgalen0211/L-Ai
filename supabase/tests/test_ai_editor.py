"""The AI editor's database side (migrations/20260929000600_ai_editor.sql).

Same harness as test_2a_core.py:
    pgvenv/Scripts/python -m unittest supabase/tests/test_ai_editor.py -v
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER


def setUpModule():
    core.setUpModule()


class AiEditor(core.Base):
    def setUp(self):
        super().setUp()
        d = self.db.as_(RYAN)
        self.pid = d.one("insert into projects (title) values ('p') returning id")
        self.vid = d.one("select id from create_version(%s)", self.pid)

    def svc(self, sql, *args):
        return self.db.as_("service").one(sql, *args)

    def switch(self, on=True, **caps):
        sets = ", ".join([f"ai_enabled = {'true' if on else 'false'}"] + [f"{k} = {v}" for k, v in caps.items()])
        self.db.as_(None).one(f"update control set {sets} returning 1")

    def session(self, who=RYAN, vid=None):
        return self.svc("select id from ai_session_for(%s, %s)", who, vid or self.vid)

    def test_switched_off_by_default_and_the_switch_works(self):
        s = self.session()
        with self.assertRaises(core.psycopg.Error) as err:
            self.svc("select ai_reserve_turn(%s, %s)", RYAN, s)
        self.assertEqual(err.exception.sqlstate, "PT503")
        self.switch(True)
        self.assertIsNotNone(self.svc("select ai_reserve_turn(%s, %s)", RYAN, s))

    def test_one_session_per_version_and_only_your_own(self):
        a, b = self.session(), self.session()
        self.assertEqual(a, b)
        with self.assertRaises(core.psycopg.Error) as err:
            self.session(OTHER)                                            # not their version
        self.assertEqual(err.exception.sqlstate, "PT404")
        self.denied("service", "select ai_session_for(%s, %s)", WORKER, self.vid)   # worker accounts can't

    def test_daily_cap_is_rolling_24_hours(self):
        self.switch(True, ai_turns_per_day=3)
        s = self.session()
        turns = [self.svc("select ai_reserve_turn(%s, %s)", RYAN, s) for _ in range(3)]
        with self.assertRaises(core.psycopg.Error) as err:
            self.svc("select ai_reserve_turn(%s, %s)", RYAN, s)
        self.assertEqual(err.exception.sqlstate, "PT429")
        self.db.as_(None).one("update ai_turns set created_at = now() - interval '25 hours' where id = %s returning 1", turns[0])
        self.assertIsNotNone(self.svc("select ai_reserve_turn(%s, %s)", RYAN, s))   # one aged out

    def test_execution_calls_are_capped_per_hour(self):
        self.switch(True, ai_exec_calls_per_hour=2)
        t = self.svc("select ai_reserve_turn(%s, %s)", RYAN, self.session())
        self.assertEqual([self.svc("select ai_allow_execution(%s)", t) for _ in range(3)], [True, True, False])
        self.switch(False)
        self.assertFalse(self.svc("select ai_allow_execution(%s)", t))       # switch off mid-turn

    def test_usage_is_priced_and_unknowns_stay_unknown(self):
        self.switch(True, ai_project_alert_usd=0.01)
        t = self.svc("select ai_reserve_turn(%s, %s)", RYAN, self.session())
        u = {"model": "claude-haiku-4-5", "message_id": "msg_1", "input_tokens": 1000, "output_tokens": 200,
             "cache_read_input_tokens": 5000, "cache_creation_input_tokens": 0, "tool_calls": 1,
             "stop_reason": "tool_use", "latency_ms": 900, "tool_log": [{"tool": "inspect_project", "ok": True}]}
        spend = self.svc("select ai_record_usage(%s, %s::jsonb)", t, json.dumps(u))
        # (1000*1 + 200*5 + 5000*0.1 + 0*1.25) / 1e6
        self.assertAlmostEqual(float(spend), 0.0025, places=6)
        self.assertFalse(self.db.as_(None).one("select spend_alert from ai_turns where id = %s", t))
        u2 = dict(u, output_tokens=None, message_id="msg_2")
        self.assertIsNone(self.svc("select ai_record_usage(%s, %s::jsonb)", t, json.dumps(u2)))   # unknown -> NULL, not 0
        self.assertIsNone(self.db.as_(None).one("select cost_usd from ai_usage where message_id = 'msg_2'"))
        u3 = dict(u, message_id="msg_3", model="claude-sonnet-5", output_tokens=2000)
        self.svc("select ai_record_usage(%s, %s::jsonb)", t, json.dumps(u3))
        self.assertAlmostEqual(float(self.db.as_(None).one("select cost_usd from ai_usage where message_id = 'msg_3'")),
                               (1000 * 2 + 2000 * 10 + 5000 * 0.2) / 1e6, places=6)

    def test_alert_flags_the_turn_past_the_project_threshold(self):
        self.switch(True, ai_project_alert_usd=0.001)
        t = self.svc("select ai_reserve_turn(%s, %s)", RYAN, self.session())
        u = {"model": "claude-haiku-4-5", "input_tokens": 1000, "output_tokens": 200,
             "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        self.svc("select ai_record_usage(%s, %s::jsonb)", t, json.dumps(u))
        self.assertTrue(self.db.as_(None).one("select spend_alert from ai_turns where id = %s", t))

    def test_finishing_a_turn_saves_the_conversation(self):
        self.switch(True)
        s = self.session()
        t = self.svc("select ai_reserve_turn(%s, %s)", RYAN, s)
        self.svc("select ai_add_ruling(%s, 'Bars start at zero.')", t)
        self.svc("select ai_finish_turn(%s, 'done', true, 3, 'Make it a map', 'Done: it is a map now.', 'Summary.')", t)
        d = self.db.as_(RYAN)
        self.assertEqual(d.all("select role, content from ai_messages order by id"),
                         [("user", "Make it a map"), ("assistant", "Done: it is a map now.")])
        self.assertEqual(d.one("select rulings, summary from ai_sessions"), (["Bars start at zero."], "Summary."))
        self.assertEqual(d.one("select status, escalated, tool_calls from ai_turns"), ("done", True, 3))
        self.denied("service", "select ai_finish_turn(%s, 'done', false, 0, null, null)", t)   # only once

    def test_turn_context_returns_recent_history_oldest_first(self):
        self.switch(True)
        s = self.session()
        for i in range(3):
            t = self.svc("select ai_reserve_turn(%s, %s)", RYAN, s)
            self.svc("select ai_finish_turn(%s, 'done', false, 0, %s, %s)", t, f"q{i}", f"a{i}")
        t = self.svc("select ai_reserve_turn(%s, %s)", RYAN, s)
        ctx = self.svc("select ai_turn_context(%s, 4)", t)
        self.assertEqual([m["content"] for m in ctx["messages"]], ["q1", "a1", "q2", "a2"])
        self.assertEqual((ctx["message_count"], ctx["tool_calls_per_turn"], ctx["rulings"]), (6, 12, []))
        self.denied(RYAN, "select ai_turn_context(%s)", t)

    def test_people_read_only_their_own_and_write_nothing(self):
        self.switch(True)
        t = self.svc("select ai_reserve_turn(%s, %s)", RYAN, self.session())
        self.svc("select ai_finish_turn(%s, 'done', false, 0, 'hi', 'hello')", t)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from ai_messages"), 0)
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from ai_messages"), 2)
        for who in (RYAN, OTHER, "anon"):
            self.denied(who, "select ai_reserve_turn(%s, %s)", RYAN, self.session())
            self.denied(who, "insert into ai_messages (session_id, owner_id, role, content) "
                             "select id, owner_id, 'user', 'x' from ai_sessions returning 1")
            self.denied(who, "select * from ai_prices")
        self.denied("anon", "select count(*) from ai_usage")


if __name__ == "__main__":
    unittest.main()
